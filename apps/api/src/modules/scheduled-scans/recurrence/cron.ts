/**
 * A deliberately small 5-field cron parser.
 *
 * `min hour day-of-month month day-of-week`, with `*`, `n`, `a,b`, `a-b`,
 * `*&#47;n` and `a-b/n`. That is the whole grammar.
 *
 * What is NOT supported, on purpose: `@reboot` and the other nicknames (they
 * are not times), seconds (a security scan is not a sub-minute event), `L`/`W`/
 * `#` (vendor extensions with no agreed semantics), and named months/days
 * (`MON`, `JAN` — a second spelling of the same thing, and the UI never emits
 * them).
 *
 * Cron is the escape hatch, not the interface. Every ordinary recurrence is
 * expressed with structured fields, so nothing here is on the path an operator
 * normally walks.
 */

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** True when the field is narrower than `*`. Drives the day-match rule below. */
  domRestricted: boolean;
  dowRestricted: boolean;
}

export class CronParseError extends Error {}

interface FieldSpec {
  name: string;
  min: number;
  max: number;
}

const FIELD_SPECS: FieldSpec[] = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
];

/** Rejects anything that is not five plain fields before parsing any of them. */
export function parseCron(expression: string): CronFields {
  if (typeof expression !== 'string') {
    throw new CronParseError('A cron expression is required');
  }

  const trimmed = expression.trim();
  if (trimmed === '') throw new CronParseError('A cron expression is required');

  // Length cap first: everything below is bounded by the field ranges, but an
  // enormous input should be rejected before it is tokenised at all.
  if (trimmed.length > 120) {
    throw new CronParseError('The cron expression is too long');
  }
  if (!/^[0-9*/,\-\s]+$/.test(trimmed)) {
    throw new CronParseError(
      'The cron expression may only contain digits, spaces and the characters * , - /',
    );
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    throw new CronParseError(
      `A cron expression has 5 fields (minute hour day-of-month month day-of-week); received ${fields.length}`,
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields.map((field, index) =>
    parseField(field, FIELD_SPECS[index]),
  );

  // 7 and 0 both mean Sunday; normalise so matching needs one representation.
  const daysOfWeek = [...new Set(dayOfWeek.map((day) => day % 7))].sort((a, b) => a - b);

  return {
    minutes: minute,
    hours: hour,
    daysOfMonth: dayOfMonth,
    months: month,
    daysOfWeek,
    domRestricted: fields[2] !== '*',
    dowRestricted: fields[4] !== '*',
  };
}

function parseField(field: string, spec: FieldSpec): number[] {
  const values = new Set<number>();

  for (const part of field.split(',')) {
    if (part === '') throw new CronParseError(`Empty value in the ${spec.name} field`);

    const [rangePart, stepPart, ...extra] = part.split('/');
    if (extra.length > 0) {
      throw new CronParseError(`Invalid step in the ${spec.name} field: "${part}"`);
    }

    let step = 1;
    if (stepPart !== undefined) {
      step = Number(stepPart);
      if (!Number.isInteger(step) || step < 1 || step > spec.max) {
        throw new CronParseError(`Invalid step in the ${spec.name} field: "${part}"`);
      }
    }

    let start: number;
    let end: number;

    if (rangePart === '*') {
      start = spec.min;
      end = spec.max;
    } else if (rangePart.includes('-')) {
      const [from, to, ...rest] = rangePart.split('-');
      if (rest.length > 0) throw new CronParseError(`Invalid range in the ${spec.name} field: "${part}"`);
      start = Number(from);
      end = Number(to);
      if (!isWithin(start, spec) || !isWithin(end, spec)) {
        throw new CronParseError(
          `The ${spec.name} field must be between ${spec.min} and ${spec.max}: "${part}"`,
        );
      }
      if (start > end) {
        throw new CronParseError(`Descending range in the ${spec.name} field: "${part}"`);
      }
    } else {
      start = Number(rangePart);
      if (!isWithin(start, spec)) {
        throw new CronParseError(
          `The ${spec.name} field must be between ${spec.min} and ${spec.max}: "${part}"`,
        );
      }
      // A bare value with a step means "from here to the end of the range",
      // which is how every cron implementation reads `5/15`.
      end = stepPart === undefined ? start : spec.max;
    }

    for (let value = start; value <= end; value += step) values.add(value);
  }

  if (values.size === 0) throw new CronParseError(`The ${spec.name} field matches nothing`);
  return [...values].sort((a, b) => a - b);
}

function isWithin(value: number, spec: FieldSpec): boolean {
  return Number.isInteger(value) && value >= spec.min && value <= spec.max;
}

/**
 * Does a calendar date satisfy the day fields?
 *
 * The historical Vixie-cron rule, which surprises people often enough to be
 * worth stating: when BOTH day-of-month and day-of-week are restricted, a date
 * matches if EITHER matches (a union, not an intersection). When only one is
 * restricted, that one decides.
 */
export function cronMatchesDate(
  fields: CronFields,
  date: { month: number; day: number; weekday: number },
): boolean {
  if (!fields.months.includes(date.month)) return false;

  const domMatches = fields.daysOfMonth.includes(date.day);
  const dowMatches = fields.daysOfWeek.includes(date.weekday);

  if (fields.domRestricted && fields.dowRestricted) return domMatches || dowMatches;
  if (fields.domRestricted) return domMatches;
  if (fields.dowRestricted) return dowMatches;
  return true;
}
