// AlertRuleEngine — evaluates operator-defined threshold rules against incoming NormalizedRecords
import type { NormalizedRecord } from './adapters/DataAdapter.js';

type Scalar = string | number | boolean | null | undefined;

function readField(data: Record<string, unknown>, path: string): Scalar {
  let value: unknown = data;
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !(part in value)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value == null ? value : undefined;
}

function parseLiteral(raw: string): Scalar {
  const value = raw.trim();
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  const quoted = value.match(/^(["'])([^"']*)\1$/);
  if (quoted) return quoted[2];
  throw new Error('Only numeric, boolean or quoted string literals are allowed');
}

function evaluateClause(clause: string, data: Record<string, unknown>): boolean {
  const match = clause.trim().match(/^([A-Za-z_][A-Za-z0-9_.]*)\s*(===|!==|>=|<=|==|!=|>|<)\s*(.+)$/);
  if (!match) throw new Error('Rule must be: field comparator literal');
  const left = readField(data, match[1]);
  const right = parseLiteral(match[3]);
  switch (match[2]) {
    case '>': return Number(left) > Number(right);
    case '>=': return Number(left) >= Number(right);
    case '<': return Number(left) < Number(right);
    case '<=': return Number(left) <= Number(right);
    case '==': case '===': return left === right;
    case '!=': case '!==': return left !== right;
    default: return false;
  }
}

export function evaluateSafeAlertExpression(expression: string, data: Record<string, unknown>): boolean {
  if (!expression.trim() || /[();`{}\[\]]/.test(expression)) throw new Error('Unsupported rule syntax');
  const orGroups = expression.split('||');
  if (orGroups.some(group => !group.trim())) throw new Error('Incomplete OR expression');
  return orGroups.some(group => {
    const clauses = group.split('&&');
    if (clauses.some(clause => !clause.trim())) throw new Error('Incomplete AND expression');
    return clauses.every(clause => evaluateClause(clause, data));
  });
}

export interface AlertRule {
  id: string;
  adapterId: string;          // only evaluate rules for this adapter
  stationCode: string;         // station this rule belongs to — rules are isolated per station
  name: string;
  expression: string;          // e.g. "defect_count > 3" or "peak_temp > 260"
  severity: 'warning' | 'critical';
  action: 'local_alert' | 'ng_trigger' | 'forward_mes';
  enabled: boolean;
}

export interface AlertResult {
  rule: AlertRule;
  record: NormalizedRecord;
}

export class AlertRuleEngine {
  private rules: AlertRule[] = [];
  private db: import('./db.js').StationDB;
  constructor(db: import('./db.js').StationDB) {
    this.db = db;
  }

  async loadRules(): Promise<void> {
    this.rules = await this.db.alertRules.toArray();
  }

  async addRule(rule: AlertRule): Promise<void> {
    // Validate expression syntax before saving
    try {
      evaluateSafeAlertExpression(rule.expression, { foo: 1, bar: 2 });
    } catch {
      throw new Error(`Invalid expression: "${rule.expression}" — check syntax`);
    }
    await this.db.alertRules.put(rule);
    this.rules.push(rule);
  }

  async updateRule(rule: AlertRule): Promise<void> {
    try {
      evaluateSafeAlertExpression(rule.expression, { foo: 1, bar: 2 });
    } catch {
      throw new Error(`Invalid expression: "${rule.expression}" — check syntax`);
    }
    await this.db.alertRules.put(rule);
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) this.rules[idx] = rule;
  }

  async removeRule(id: string): Promise<void> {
    await this.db.alertRules.delete(id);
    this.rules = this.rules.filter((r) => r.id !== id);
  }

  /** Evaluate all enabled rules for a given record. Returns the first matching rule. */
  evaluate(record: NormalizedRecord, stationCode?: string): AlertResult | null {
    const matchingRules = this.rules.filter(
      (r) => r.enabled && (r.stationCode === (stationCode ?? record.source)),
    );

    for (const rule of matchingRules) {
      try {
        const result = evaluateSafeAlertExpression(rule.expression, record.data as Record<string, unknown>);
        if (result) {
          return { rule, record };
        }
      } catch {
        // expression error or false — skip
      }
    }
    return null;
  }

  getRulesForAdapter(adapterId: string): AlertRule[] {
    return this.rules.filter((r) => r.adapterId === adapterId);
  }

  getAllRules(): AlertRule[] {
    return [...this.rules];
  }
}
