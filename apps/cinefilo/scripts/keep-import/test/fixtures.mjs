/** Neutral fixture list (public titles only) covering each pattern of the design Context. */
export const SAMPLE = `watched
Inception
Fracture (2007)
**Heat**
Close - Belgium
Alien (2a vez)
Dune (II)
Amelie (confort)
Taxi Driver (20.03.2025)
Pirates of the Caribbean 1, 2, 3, 4
Hunger Games 1 y 2
Matrix 1,2 y 3
Pearl (trilogy)
Heat / Ronin
Severance (serie)
Alien
Face/Off

watch_later
Nine
Inception
Zodiac
`;

const movie = (id, title, original, date, popularity, overview = '', extra = {}) => ({
  adult: false, id, title, original_title: original, overview, release_date: date, popularity, media_type: 'movie', ...extra,
});
const tv = (id, name, original, date, popularity, overview = '') => ({
  id, name, original_name: original, overview, first_air_date: date, popularity, media_type: 'tv',
});

export const RESPONSES = {
  'search/multi|Inception|es-ES': [movie(27205, 'Origen', 'Inception', '2010-07-15', 80, 'A thief who steals corporate secrets.')],
  'search/multi|Inception|en-US': [movie(27205, 'Inception', 'Inception', '2010-07-15', 80, 'A thief who steals corporate secrets.'), { id: 5, name: 'Inception Actor', media_type: 'person', popularity: 3 }],
  'search/multi|Nine|es-ES': [movie(12, 'Nine', 'Nine', '2009-12-18', 20, 'A film director struggles with the women in his life while preparing his next movie and a very long overview.'), movie(13, 'Nueve', 'Nine', '1999-01-01', 18, 'Another one.'), tv(14, 'Nine', 'Nine', '2012-01-01', 15)],
  'search/multi|Nine|en-US': [movie(12, 'Nine', 'Nine', '2009-12-18', 20), movie(13, 'Nine', 'Nine', '1999-01-01', 18)],
  'search/multi|Severance|es-ES': [tv(95396, 'Severance', 'Severance', '2022-02-18', 300), movie(1123, 'Severance', 'Severance', '2006-08-25', 12)],
  'search/multi|Severance|en-US': [tv(95396, 'Severance', 'Severance', '2022-02-18', 300), movie(1123, 'Severance', 'Severance', '2006-08-25', 12)],
  'search/tv|Severance|es-ES': [tv(95396, 'Severance', 'Severance', '2022-02-18', 300)],
  'search/tv|Severance|en-US': [tv(95396, 'Severance', 'Severance', '2022-02-18', 300)],
  'search/multi|Zodiac|es-ES': [],
  'search/multi|Zodiac|en-US': [],
};

const part = (id, title, date) => ({ id, title, original_title: title, overview: '', release_date: date, popularity: 10 });
export const COLLECTIONS = {
  'Pearl': { search: [{ id: 900, name: 'Pearl - Collection' }], parts: [part(903, 'Pearl 3', '2024-01-01'), part(901, 'Pearl 1', '2020-01-01'), part(902, 'Pearl 2', '2022-01-01')] },
};

/** Fake `fetch` in TMDB's documented response shapes; records every URL it is asked for. */
export function fakeFetch(log = []) {
  return async (url, init = {}) => {
    log.push({ url, init });
    const u = new URL(url);
    const ep = u.pathname.replace('/3/', '');
    const q = u.searchParams.get('query');
    const lang = u.searchParams.get('language');
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (ep === 'search/collection') {
      const c = COLLECTIONS[q];
      return ok({ page: 1, results: c ? c.search : [] });
    }
    const colId = ep.match(/^collection\/(\d+)$/);
    if (colId) {
      const c = Object.values(COLLECTIONS).find((x) => String(x.search[0].id) === colId[1]);
      return ok({ id: Number(colId[1]), name: 'x', parts: c.parts });
    }
    return ok({ page: 1, results: RESPONSES[`${ep}|${q}|${lang}`] ?? [], total_pages: 1 });
  };
}
