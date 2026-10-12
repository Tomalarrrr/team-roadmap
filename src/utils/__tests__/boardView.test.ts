import { describe, it, expect } from 'vitest';
import { boardViewFromSearch, searchWithBoardView } from '../boardView';

describe('boardViewFromSearch', () => {
  it('opens on the programme view only when the URL asks for it', () => {
    expect(boardViewFromSearch('?view=programmes')).toBe('programmes');
    expect(boardViewFromSearch('?embed=1&view=programmes')).toBe('programmes');
    expect(boardViewFromSearch('')).toBe('people');
    expect(boardViewFromSearch('?view=anything')).toBe('people');
  });
});

describe('searchWithBoardView', () => {
  it('adds and removes the view without disturbing other parameters', () => {
    expect(searchWithBoardView('?embed=1', 'programmes')).toBe('?embed=1&view=programmes');
    expect(searchWithBoardView('?embed=1&view=programmes', 'people')).toBe('?embed=1');
    expect(searchWithBoardView('?view=programmes', 'people')).toBe('');
  });
});
