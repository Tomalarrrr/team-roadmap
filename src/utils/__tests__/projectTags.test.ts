import { describe, it, expect } from 'vitest';
import type { Project } from '../../types';
import { addTag, tagsInUse } from '../projectTags';

function makeProject(id: string, tags?: string[]): Project {
  return {
    id,
    title: id,
    owner: 'Amy',
    startDate: '2026-01-01',
    endDate: '2026-03-01',
    statusColor: '#457028',
    size: 'small',
    milestones: [],
    tags,
  };
}

describe('tagsInUse', () => {
  it('lists each tag once, alphabetically regardless of case', () => {
    const projects = [
      makeProject('a', ['Infrastructure', 'clinical']),
      makeProject('b', ['Clinical', 'Infrastructure']),
      makeProject('c'),
    ];
    expect(tagsInUse(projects)).toEqual(['clinical', 'Clinical', 'Infrastructure']);
  });

  it('is empty when no project is tagged', () => {
    expect(tagsInUse([makeProject('a'), makeProject('b', [])])).toEqual([]);
  });

  it('stops listing a tag once its last project drops it', () => {
    expect(tagsInUse([makeProject('a', ['Clinical'])])).toEqual(['Clinical']);
    expect(tagsInUse([makeProject('a', [])])).toEqual([]);
  });
});

describe('addTag', () => {
  it('appends a trimmed tag with inner whitespace collapsed', () => {
    expect(addTag(['Clinical'], '  Data   quality ', [])).toEqual(['Clinical', 'Data quality']);
  });

  it('adopts the spelling already on the board', () => {
    expect(addTag([], 'infrastructure', ['Clinical', 'Infrastructure'])).toEqual(['Infrastructure']);
  });

  it('keeps the typed spelling for a tag the board has not seen', () => {
    expect(addTag([], 'Finance', ['Clinical'])).toEqual(['Finance']);
  });

  it('splits on commas, skipping blanks and repeats', () => {
    expect(addTag(['Clinical'], 'Finance, ,clinical,  Data  quality,finance', ['Clinical']))
      .toEqual(['Clinical', 'Finance', 'Data quality']);
  });

  it('returns the same array for blank input or a tag the project already has', () => {
    const tags = ['Clinical'];
    expect(addTag(tags, '   ', [])).toBe(tags);
    expect(addTag(tags, 'CLINICAL', ['Clinical'])).toBe(tags);
  });
});
