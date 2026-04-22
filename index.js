/**
 * CodeLens - JavaScript Code Intelligence Tool
 *
 * Static analysis tool that provides instant insight into any JS codebase:
 *   - Extracts all function signatures, params, and types
 *   - Computes cyclomatic complexity with McCabe grading (A-F)
 *   - Detects 8 common code quality issues with severity levels
 *   - Auto-generates JSDoc documentation from code structure
 *   - Produces structured quality reports
 *
 * No dependencies. Works on any JS string. Zero setup.
 */

// ─── Function Extractor ───────────────────────────────────────────────────────

class FunctionExtractor {
  extract(code) {
    const results = [];
    const seen = new Set();

    // Three major function forms in JS
    const patterns = [
      { regex: /function\s+(\w+)\s*\(([^)]*)\)\s*\{/g,                               type: 'declaration' },
      { regex: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\(([^)]*)\)\s*\{/g, type: 'expression'  },
      { regex: /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g,    type: 'arrow'       },
    ];

    for (const { regex, type } of patterns) {
      let m;
      while ((m = regex.exec(code)) !== null) {
        const name = m[1];
        if (seen.has(name)) continue;
        seen.add(name);

        const params = m[2] ? m[2].split(',').map(p => p.trim()).filter(Boolean) : [];
        const startLine = code.slice(0, m.index).split('\n').length;
        const body = this._extractBody(code, m.index + m[0].length - 1);

        results.push({ name, params, type, startLine, body, loc: body.split('\n').length });
      }
    }

    return results;
  }

  _extractBody(code, from) {
    let pos = from;
    // Scan forward to the opening brace (handles arrow functions: `=> {`)
    while (pos < code.length && code[pos] !== '{') pos++;

    let depth = 0, inStr = false, strCh = '', i = pos;
    while (i < code.length) {
      const ch = code[i];
      if (inStr) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === strCh) inStr = false;
      } else {
        if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strCh = ch; }
        else if (ch === '{') depth++;
        else if (ch === '}') { if (--depth === 0) return code.slice(pos, i + 1); }
      }
      i++;
    }
    return code.slice(pos);
  }
}

// ─── Complexity Analyzer ──────────────────────────────────────────────────────

class ComplexityAnalyzer {
  compute(fn) {
    const b = fn.body;

    // McCabe cyclomatic complexity: 1 + number of decision points
    // Note: `else if` is already captured by the `if` pattern — no double-counting
    const decisions = [
      /\bif\s*\(/g, /\bfor\s*\(/g, /\bwhile\s*\(/g,
      /\bdo\s*\{/g, /\bcase\s+[^:]+:/g, /\bcatch\s*\(/g,
      /\?\s*\S/g, /&&/g, /\|\|/g,
    ];

    let complexity = 1;
    for (const p of decisions) {
      const hits = b.match(p);
      if (hits) complexity += hits.length;
    }

    let depth = 0, maxDepth = 0;
    for (const ch of b) {
      if (ch === '{') { if (++depth > maxDepth) maxDepth = depth; }
      else if (ch === '}') depth--;
    }

    const grade =
      complexity <=  4 ? { letter: 'A', label: 'Simple'        } :
      complexity <=  7 ? { letter: 'B', label: 'Moderate'      } :
      complexity <= 10 ? { letter: 'C', label: 'Complex'       } :
      complexity <= 15 ? { letter: 'D', label: 'Very Complex'  } :
                         { letter: 'F', label: 'Unmaintainable' };

    return { cyclomatic: complexity, loc: fn.loc, nestingDepth: Math.max(0, maxDepth - 1), params: fn.params.length, grade };
  }
}

// ─── Lint Checker ─────────────────────────────────────────────────────────────

class LintChecker {
  constructor() {
    this.rules = [
      { id: 'no-console',      sev: 'warning', msg: 'Remove console statements before production',         test: (b)    => /console\.(log|error|warn|debug)/.test(b)              },
      { id: 'no-eval',         sev: 'error',   msg: 'eval() is a security risk and disables optimizations', test: (b)    => /\beval\s*\(/.test(b)                                  },
      { id: 'empty-catch',     sev: 'error',   msg: 'Empty catch silently swallows errors',                test: (b)    => /catch\s*\([^)]*\)\s*\{\s*\}/.test(b)                  },
      { id: 'no-var',          sev: 'info',    msg: 'Prefer const/let over var for proper block scoping',  test: (b)    => /\bvar\s+\w/.test(b)                                   },
      { id: 'magic-numbers',   sev: 'info',    msg: 'Replace magic numbers with named constants',          test: (b)    => /[^.\w][2-9]\d{2,}/.test(b)                            },
      { id: 'too-many-params', sev: 'warning', msg: 'More than 4 params; consider an options object',     test: (b, f) => f.params.length > 4                                    },
      { id: 'deep-nesting',    sev: 'warning', msg: 'Deep nesting (>3); use early returns or extract fns', test: (b)    => { let d=0,m=0; for(const c of b){if(c==='{'){d++;m=d>m?d:m;}else if(c==='}')d--;} return m > 4; } },
      { id: 'large-function',  sev: 'warning', msg: 'Function exceeds 40 lines; consider splitting it',   test: (b, f) => f.loc > 40                                             },
    ];
  }

  check(fn) {
    return this.rules
      .filter(r => r.test(fn.body, fn))
      .map(r => ({ rule: r.id, severity: r.sev, message: r.msg, function: fn.name, line: fn.startLine }));
  }
}

// ─── Doc Generator ────────────────────────────────────────────────────────────

class DocGenerator {
  generate(fn) {
    const paramLines = fn.params.map(p => ' * @param {' + this._inferType(p) + '} ' + p);
    const ret = this._inferReturn(fn.body);
    const retLine = ret ? [' * @returns {' + ret + '}'] : [];
    return ['/**', ' * ' + this._describe(fn.name), ' *', ...paramLines, ...retLine, ' */'].join('\n');
  }

  _describe(name) {
    const words = name.replace(/([A-Z])/g, ' $1').trim();
    if (/^get|^fetch/i.test(name))   return 'Retrieves '  + words.replace(/^(get|fetch)\s*/i,          '');
    if (/^set|^update/i.test(name))  return 'Updates '    + words.replace(/^(set|update)\s*/i,         '');
    if (/^is|^has|^can/i.test(name)) return 'Checks if '  + words.replace(/^(is|has|can)\s*/i,         '');
    if (/^create|^build/i.test(name)) return 'Creates '   + words.replace(/^(create|build)\s*/i,       '');
    if (/^delete|^remove/i.test(name)) return 'Removes '  + words.replace(/^(delete|remove)\s*/i,      '');
    if (/^parse|^extract/i.test(name)) return 'Parses '   + words.replace(/^(parse|extract)\s*/i,      '');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  _inferType(p) {
    const lp = p.toLowerCase();
    if (/id$|idx$|count$|num$|size$|len$|offset$/.test(lp)) return 'number';
    if (/name$|str$|text$|key$|path$|url$|msg$|label$/.test(lp)) return 'string';
    if (/^is|^has|^can|flag$|enabled$|visible$/.test(lp)) return 'boolean';
    if (/list$|arr$|items$|rows$|elements$/.test(lp)) return 'Array';
    if (/map$|obj$|opts$|config$|params$|data$|options$/.test(lp)) return 'Object';
    if (/fn$|cb$|handler$|callback$|listener$/.test(lp)) return 'Function';
    return '*';
  }

  _inferReturn(body) {
    if (/\breturn\s+(true|false|!)/.test(body))            return 'boolean';
    if (/\breturn\s+\d/.test(body))                        return 'number';
    if (/\breturn\s+['"]/.test(body))                      return 'string';
    if (/\breturn\s+\[/.test(body))                        return 'Array';
    if (/\breturn\s+\{/.test(body))                        return 'Object';
    if (/\breturn\s+new\s+Promise|async\s+function/.test(body)) return 'Promise';
    if (/\breturn\s+/.test(body))                          return '*';
    return null;
  }
}

// ─── Report Formatter ─────────────────────────────────────────────────────────

class ReportFormatter {
  format(functions, issues, metrics) {
    const SEP = '='.repeat(62);
    const sub = '-'.repeat(62);
    const out = [
      '', SEP,
      '  CODELENS  |  JavaScript Code Intelligence Report',
      SEP, '',
      '  SUMMARY',
      '  ' + sub.slice(2),
      '  Functions analyzed : ' + functions.length,
      '  Avg complexity     : ' + (metrics.reduce((s, m) => s + m.cyclomatic, 0) / (metrics.length || 1)).toFixed(1),
      '  Issues found       : ' + issues.length +
        '  (' + issues.filter(i => i.severity === 'error').length + ' errors, ' +
        issues.filter(i => i.severity === 'warning').length + ' warnings, ' +
        issues.filter(i => i.severity === 'info').length + ' info)',
      '',
      '  FUNCTION DETAILS',
      '  ' + sub.slice(2),
    ];

    functions.forEach((fn, idx) => {
      const m  = metrics[idx];
      const fi = issues.filter(i => i.function === fn.name);
      out.push(
        '',
        '  ' + fn.name + '()   line ' + fn.startLine + '  [' + fn.type + ']',
        '  Complexity : ' + m.cyclomatic + '   Grade : ' + m.grade.letter + ' - ' + m.grade.label,
        '  Lines      : ' + m.loc + '   Nesting : ' + m.nestingDepth,
        '  Params     : ' + (fn.params.length ? fn.params.join(', ') : '(none)'),
      );
      if (fi.length) {
        out.push('  Issues :');
        fi.forEach(i => {
          const tag = i.severity === 'error' ? '[ERR] ' : i.severity === 'warning' ? '[WARN]' : '[INFO]';
          out.push('    ' + tag + '  ' + i.message + '  (' + i.rule + ')');
        });
      }
    });

    out.push('', SEP, '');
    return out.join('\n');
  }
}

// ─── Main API ─────────────────────────────────────────────────────────────────

class CodeLens {
  constructor() {
    this.extractor  = new FunctionExtractor();
    this.complexity = new ComplexityAnalyzer();
    this.linter     = new LintChecker();
    this.docgen     = new DocGenerator();
    this.reporter   = new ReportFormatter();
  }

  /**
   * Analyze a JavaScript code string.
   * @param {string} code - Raw JavaScript source
   * @returns {{ report: string, functions: Array, issues: Array, docs: Array, metrics: Array }}
   */
  analyze(code) {
    try {
      const functions = this.extractor.extract(code);
      if (!functions.length) return { report: 'No named functions found.', functions: [], issues: [], docs: [], metrics: [] };

      const metrics = functions.map(fn => this.complexity.compute(fn));
      const issues  = functions.flatMap(fn => this.linter.check(fn));
      const docs    = functions.map(fn => this.docgen.generate(fn));
      const report  = this.reporter.format(functions, issues, metrics);

      return { report, functions, issues, docs, metrics };
    } catch (err) {
      return { error: 'Analysis failed: ' + err.message, report: '', functions: [], issues: [], docs: [], metrics: [] };
    }
  }
}

module.exports = { CodeLens, FunctionExtractor, ComplexityAnalyzer, LintChecker, DocGenerator };

// ─── Demo ─────────────────────────────────────────────────────────────────────

const SAMPLE = [
  'function calculateTax(income, rate, deductions, credits, filingStatus) {',
  '  var taxableIncome = income - deductions;',
  '  if (filingStatus === "single") {',
  '    if (taxableIncome > 500000) { return taxableIncome * 0.37 - credits; }',
  '    else if (taxableIncome > 200000) { return taxableIncome * 0.32 - credits; }',
  '    else if (taxableIncome > 100000) { return taxableIncome * 0.24 - credits; }',
  '  } else if (filingStatus === "married") {',
  '    if (taxableIncome > 600000) { return taxableIncome * 0.37 - credits; }',
  '  }',
  '  return taxableIncome * rate - credits;',
  '}',
  '',
  'const getUserById = async function(id, db, cache) {',
  '  try {',
  '    if (cache.has(id)) { return cache.get(id); }',
  '    console.log("fetching user", id);',
  '    const user = await db.query(id);',
  '    cache.set(id, user);',
  '    return user;',
  '  } catch (err) {}',
  '};',
  '',
  'function isValidEmail(email) {',
  '  const parts = email.split("@");',
  '  return parts.length === 2 && parts[1].includes(".") && parts[0].length > 0;',
  '}',
  '',
  'function buildQueryString(params) {',
  '  return Object.entries(params)',
  '    .filter(function(e) { return e[1] !== null && e[1] !== undefined; })',
  '    .map(function(e) { return encodeURIComponent(e[0]) + "=" + encodeURIComponent(e[1]); })',
  '    .join("&");',
  '}',
].join('\n');

const lens = new CodeLens();
const result = lens.analyze(SAMPLE);

console.log(result.report);

console.log('\n=== AUTO-GENERATED JSDoc ===\n');
result.functions.forEach(function(fn, i) {
  console.log(result.docs[i]);
  console.log('function ' + fn.name + '(' + fn.params.join(', ') + ') { ... }\n');
});
