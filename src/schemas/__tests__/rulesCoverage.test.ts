/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  projectSchema,
  milestoneSchema,
  teamMemberSchema,
  dependencySchema,
  leaveBlockSchema,
  periodMarkerSchema,
} from '../roadmap';

// ---------------------------------------------------------------------------
// Guard against the class of bug where a field is added to the data model but
// NOT to the Firebase security rules. Because every entity node in the rules
// ends with `"$other": { ".validate": false }`, any field the app writes that
// the rules don't explicitly allow is rejected by Firebase with a 401
// "Permission denied" — silently breaking saves in production (this is exactly
// what happened with the `size` field). This test fails CI if the rules ever
// fall out of sync with the Zod schemas (the canonical writable shape).
// ---------------------------------------------------------------------------

type RuleNode = Record<string, unknown>;

// Vitest runs from the project root, where database.rules.json lives.
const rules = JSON.parse(
  readFileSync(resolve(process.cwd(), 'database.rules.json'), 'utf-8'),
) as { rules: RuleNode };

// Pull the field keys out of a Zod object schema, transparently unwrapping the
// ZodEffects produced by `.refine()` so refined schemas work too.
function schemaKeys(schema: z.ZodTypeAny): string[] {
  let s: z.ZodTypeAny | undefined = schema;
  // Walk inner types until we find one exposing `.shape` (the ZodObject).
  for (let i = 0; i < 10 && s; i++) {
    const shape = (s as unknown as { shape?: Record<string, unknown> }).shape;
    if (shape) return Object.keys(shape);
    const def = (s as unknown as { _def?: { schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny }; def?: { schema?: z.ZodTypeAny; innerType?: z.ZodTypeAny } });
    const inner = def._def?.schema ?? def._def?.innerType ?? def.def?.schema ?? def.def?.innerType;
    s = inner;
  }
  throw new Error('Could not extract shape from schema');
}

// The explicitly-allowed child field names declared in a rules node (everything
// that isn't a `.meta`/`$wildcard` key).
function allowedFields(node: RuleNode): string[] {
  return Object.keys(node).filter((k) => !k.startsWith('.') && !k.startsWith('$'));
}

const roadmap = rules.rules.roadmap as RuleNode;
const projectNode = (roadmap.projects as RuleNode).$projectId as RuleNode;
const milestoneNode = (projectNode.milestones as RuleNode).$milestoneId as RuleNode;

const CASES: { name: string; schema: z.ZodTypeAny; node: RuleNode }[] = [
  { name: 'projects', schema: projectSchema, node: projectNode },
  { name: 'projects/milestones', schema: milestoneSchema, node: milestoneNode },
  { name: 'teamMembers', schema: teamMemberSchema, node: (roadmap.teamMembers as RuleNode).$memberId as RuleNode },
  { name: 'dependencies', schema: dependencySchema, node: (roadmap.dependencies as RuleNode).$depId as RuleNode },
  { name: 'leaveBlocks', schema: leaveBlockSchema, node: (roadmap.leaveBlocks as RuleNode).$leaveId as RuleNode },
  { name: 'periodMarkers', schema: periodMarkerSchema, node: (roadmap.periodMarkers as RuleNode).$markerId as RuleNode },
];

describe('Firebase security rules cover every schema field', () => {
  it.each(CASES)('$name: every schema field is permitted by the rules', ({ schema, node }) => {
    const allowed = new Set(allowedFields(node));
    const missing = schemaKeys(schema).filter((k) => !allowed.has(k));
    // If this fails: a model field is missing from database.rules.json, so
    // writing it will be rejected with 401 in production. Add it to the rules.
    expect(missing).toEqual([]);
  });

  it.each(CASES)('$name: has the strict "$other" guard (so extra fields are caught)', ({ node }) => {
    // The guard only bites if `$other` denies unlisted fields. If this is ever
    // relaxed, the coverage check above stops being meaningful.
    expect((node.$other as RuleNode)?.['.validate']).toBe(false);
  });

  it('the project "size" field specifically is allowed (regression: prod 401)', () => {
    expect(allowedFields(projectNode)).toContain('size');
  });
});

// ---------------------------------------------------------------------------
// The same guard for the Ludo games. There is no Zod schema for the game state
// — it is a TypeScript interface — so the field list is read straight out of
// the source rather than restated here, which is the only version that cannot
// drift. The `lastRoll` field is exactly the bug this catches: added to the
// interface and written on every roll, but absent from the rules, so
// `$other: false` denied every write in the game.
// ---------------------------------------------------------------------------

const ludoSource = (file: string) =>
  readFileSync(resolve(process.cwd(), file), 'utf-8');

/** Field names declared in `interface <name> { ... }`, comments stripped. */
function interfaceFields(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start === -1) throw new Error(`interface ${name} not found`);
  let depth = 0;
  let end = start;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) { end = i; break; }
  }
  const body = source
    .slice(source.indexOf('{', start) + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  // Only top-level members: skip anything nested inside an inline object type.
  const fields: string[] = [];
  let nest = 0;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    const match = nest === 0 && /^([A-Za-z_$][\w$]*)\??\s*:/.exec(line);
    if (match) fields.push(match[1]);
    nest += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return fields;
}

const LUDO_CASES = [
  { game: 'ludo2', source: 'src/ludo2Board.ts', interfaces: ['Ludo2GameState', 'Ludo2MoveUpdate'] },
  { game: 'ludo4', source: 'src/ludo4Board.ts', interfaces: ['Ludo4GameState', 'Ludo4MoveUpdate'] },
];

describe.each(LUDO_CASES)('Firebase security rules cover every $game state field', ({ game, source, interfaces }) => {
  const gameNode = ((rules.rules[game] as RuleNode).$gameCode) as RuleNode;

  it.each(interfaces)('%s: every field is permitted by the rules', (name) => {
    const allowed = new Set(allowedFields(gameNode));
    const missing = interfaceFields(ludoSource(source), name).filter((k) => !allowed.has(k));
    expect(missing).toEqual([]);
  });

  it('has the strict "$other" guard (so extra fields are caught)', () => {
    expect((gameNode.$other as RuleNode)?.['.validate']).toBe(false);
  });

  it('the "lastRoll" field specifically is allowed (regression: every write 401d)', () => {
    expect(allowedFields(gameNode)).toContain('lastRoll');
  });

  // The seat a room's creator took. Seats are handed out at random, so without
  // this stored the host cannot be identified — and an unlisted field is denied.
  it('the "host" field is allowed (random seat assignment depends on it)', () => {
    expect(allowedFields(gameNode)).toContain('host');
  });
});
