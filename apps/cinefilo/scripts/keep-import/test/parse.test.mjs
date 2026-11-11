import { describe, expect, it } from 'vitest';
import { parseList } from '../parse.mjs';
import { SAMPLE } from './fixtures.mjs';

const { entries, dropped } = parseList(SAMPLE);
const by = (title) => entries.find((e) => e.title === title);

describe('parseList', () => {
  it('splits the two lists by their headers', () => {
    expect(by('Inception').list).toBe('watched');
    expect(by('Nine').list).toBe('later');
    expect(by('Zodiac').line).toBe(22);
    expect(entries.some((e) => /^(watched|watch_later)$/.test(e.title))).toBe(false);
  });
  it('strips ** and keeps year hints', () => {
    expect(by('Heat').title).toBe('Heat');
    expect(by('Fracture')).toMatchObject({ year: 2007 });
  });
  it('keeps a trailing "- hint" as hint', () => {
    expect(by('Close')).toMatchObject({ hint: 'Belgium' });
  });
  it('strips notes but keeps them in note', () => {
    expect(by('Dune')).toMatchObject({ note: 'II' });
    expect(by('Amelie')).toMatchObject({ note: 'confort' });
    expect(by('Taxi Driver')).toMatchObject({ note: '20.03.2025' });
    expect(by('Taxi Driver').year).toBeUndefined();
  });
  it('drops duplicates, within and across lists, including "(2a vez)" repeats', () => {
    expect(entries.filter((e) => e.title === 'Alien')).toHaveLength(1);
    expect(entries.filter((e) => e.title === 'Inception')).toHaveLength(1);
    expect(dropped.map((d) => d.title)).toEqual(expect.arrayContaining(['Alien', 'Inception']));
    expect(dropped.every((d) => d.reason === 'duplicate')).toBe(true);
  });
  it('expands "1, 2, 3, 4", "1 y 2" and "1,2 y 3" into numbered parts', () => {
    expect(entries.filter((e) => e.title.startsWith('Pirates of the Caribbean')).map((e) => e.title)).toEqual(
      [1, 2, 3, 4].map((n) => `Pirates of the Caribbean ${n}`),
    );
    expect(entries.filter((e) => e.multi?.base === 'Hunger Games').map((e) => e.multi.number)).toEqual([1, 2]);
    expect(entries.filter((e) => e.multi?.base === 'Matrix').map((e) => e.id)).toEqual(['12.1', '12.2', '12.3']);
  });
  it('marks (trilogy) for collection expansion', () => {
    expect(by('Pearl')).toMatchObject({ expand: 'collection' });
  });
  it('splits "A / B" but not "Face/Off"', () => {
    expect(by('Ronin')).toBeTruthy();
    expect(by('Face/Off')).toBeTruthy();
    expect(entries.filter((e) => e.title === 'Heat')).toHaveLength(1);
  });
  it('reads kind hints like (serie)', () => {
    expect(by('Severance')).toMatchObject({ kind: 'series' });
  });
  it('handles CRLF and bullets', () => {
    expect(parseList('watched\r\n- Alien\r\n').entries.map((e) => e.title)).toEqual(['Alien']);
  });
});
