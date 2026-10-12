/**
 * Which way the board is laid out: by person (the planning board) or by
 * programme (the read-only summary for people who do not plan on it). Carried
 * in the URL as `?view=programmes` so a link, or an embed, opens straight on it.
 */
export type BoardView = 'people' | 'programmes';

export function boardViewFromSearch(search: string): BoardView {
  return new URLSearchParams(search).get('view') === 'programmes' ? 'programmes' : 'people';
}

/** The query string for `view`, leaving every other parameter as it was. */
export function searchWithBoardView(search: string, view: BoardView): string {
  const params = new URLSearchParams(search);
  if (view === 'programmes') params.set('view', 'programmes'); else params.delete('view');
  const query = params.toString();
  return query ? `?${query}` : '';
}
