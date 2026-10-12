# Form schema and expression language

This is the normative spec for form schemas, the expression language used by calculated
fields and conditional visibility, and form evaluation. Two implementations exist:

- TypeScript: `packages/shared/src/expr/` and `packages/shared/src/forms/` (web, mobile)
- Python: `api/app/forms/` (authoritative; recomputes on every write)

Both must pass every case in `spec/expr-cases.json` and `spec/form-cases.json`. When the
two disagree, the spec wins; add a case that pins the behavior before fixing either.

All JSON keys are `snake_case`.

## Schema

```json
{
  "schema_version": 1,
  "sections": [
    {
      "key": "wellness",
      "title": "This morning",
      "description": "Rate each item for the last 24 hours.",
      "visible_if": null,
      "fields": [
        { "key": "sleep_quality", "type": "scale", "label": "Sleep quality",
          "required": true, "min": 1, "max": 7, "step": 1,
          "anchors": { "min": "Very, very good", "max": "Very, very bad" } },
        { "key": "hooper_total", "type": "calculated", "label": "Hooper index",
          "expression": "sum(sleep_quality, fatigue, stress, soreness)", "decimals": 0 }
      ]
    }
  ]
}
```

### Section

| Key | Type | Required | Notes |
|---|---|---|---|
| `key` | identifier | yes | Unique among sections |
| `title` | string | yes | |
| `description` | string | no | Markdown |
| `visible_if` | expression | no | Hides every field in the section when false |
| `fields` | Field[] | yes | At least one |

### Field (common keys)

| Key | Type | Required | Notes |
|---|---|---|---|
| `key` | identifier | yes | Unique across the whole schema (all sections). Pattern `^[a-z][a-z0-9_]{0,62}$`. Reserved words below are not allowed |
| `type` | enum | yes | See field types |
| `label` | string | yes | |
| `help` | string | no | Markdown shown under the label |
| `required` | bool | no | Default `false`. Only enforced when the field is visible. Ignored for `calculated` and `info` |
| `visible_if` | expression | no | Field is hidden when this evaluates to anything other than `true` |
| `unit` | string | no | Display only, e.g. `"min"`, `"kg"`, `"AU"` |

### Field types

| `type` | Stored value | Extra keys |
|---|---|---|
| `number` | number | `min`, `max`, `step` (default any), `decimals` (display + rounding of input) |
| `scale` | number | `min` (req), `max` (req), `step` (default 1), `anchors` `{min?, max?, mid?}`, `display`: `"buttons"` \| `"slider"` (default buttons when ≤ 11 points) |
| `select` | string \| number | `options` (req): `[{value, label}]`, values unique, all strings or all numbers |
| `multiselect` | array of option values | `options` (req), `min_selected`, `max_selected` |
| `boolean` | bool | |
| `text` | string | `max_length` (default 500) |
| `textarea` | string | `max_length` (default 5000) |
| `date` | `"YYYY-MM-DD"` | `min`, `max` as dates |
| `time` | `"HH:MM"` (24 h) | |
| `datetime` | ISO 8601 with offset | |
| `duration` | number, minutes | `min`, `max` (minutes). UI may enter h:m |
| `calculated` | number \| bool \| string \| null | `expression` (req), `decimals` (round numeric results, half away from zero) |
| `info` | – (no value) | Static content: `label` is the heading, `help` is the body |

Identifiers reserved by the language and therefore not usable as keys: `and`, `or`,
`not`, `true`, `false`, `null`, and every function name listed below.

### Schema validation (errors block publishing)

1. `schema_version` is `1`.
2. Section keys unique; field keys unique across the schema and match the pattern; no
   reserved words.
3. Required extra keys present and well-typed for each field type (`scale` needs `min <
   max`, `select`/`multiselect` need ≥ 1 option with unique values, `calculated` needs an
   `expression`).
4. Every expression parses.
5. Every identifier referenced by an expression is a field key in the schema whose type
   holds a value (not `info`).
6. Calculated fields form no dependency cycle (a calculated field may reference other
   calculated fields).
7. A `visible_if` may not reference its own field, nor (for a section) a field inside
   that section.

Validation returns a list of `{path, message}`. Paths are `/`-joined and name the
offending key:

| Problem | Path |
|---|---|
| `schema_version` wrong | `schema_version` |
| Section has no fields | `sections/{i}/fields` |
| Duplicate or invalid key (the later occurrence of a duplicate) | `sections/{i}/key`, `sections/{i}/fields/{j}/key` |
| Unknown `type`, missing `label` | `sections/{i}/fields/{j}/type`, `.../label` |
| `scale` with `min >= max` | `sections/{i}/fields/{j}/max` |
| Options empty, duplicate values, or mixed string/number values | `sections/{i}/fields/{j}/options` |
| Expression missing, unparsable, referencing an unknown or `info` field, or in a cycle | `sections/{i}/fields/{j}/expression` (every field in a cycle is reported) |
| `visible_if` unparsable, unknown/`info` reference, or self-reference | `sections/{i}/fields/{j}/visible_if`, `sections/{i}/visible_if` |

`spec/schema-cases.json` compares the set of paths only; messages are free text.

## Expression language

Small, total, side-effect free. No loops, no assignment, no property access.

### Grammar (precedence low → high)

```
expr        := or
or          := and ( ("or" | "||") and )*
and         := not ( ("and" | "&&") not )*
not         := ("not" | "!") not | comparison
comparison  := additive ( ("==" | "!=" | "<" | "<=" | ">" | ">=") additive )?
additive    := multiplicative ( ("+" | "-") multiplicative )*
multiplicative := unary ( ("*" | "/" | "%") unary )*
unary       := "-" unary | power
power       := primary ( "^" unary )?            # right-associative: 2^3^2 = 2^9
primary     := number | string | "true" | "false" | "null"
             | identifier
             | identifier "(" [ expr ("," expr)* ] ")"
             | "(" expr ")"
number      := ( digits [ "." digits ] | "." digits ) [ ("e"|"E") ["+"|"-"] digits ]
string      := '"' chars '"' | "'" chars "'"     # backslash escapes \" \' \\ \n \t
identifier  := [a-z_][a-z0-9_]*                   # case-sensitive; keywords are lowercase
```

Comparisons do not chain (`a < b < c` is a parse error). Whitespace is insignificant.
`-2^2` is `-(2^2) = -4`.

### Values

`number` (IEEE 754 double), `string`, `bool`, `null`, `list` (only from `multiselect`
values; there is no list literal). An identifier evaluates to the field's current value,
or `null` when the field is unset, empty string, or hidden.

### Semantics

| Construct | Rule |
|---|---|
| Arithmetic `+ - * / % ^`, unary `-` | Both operands numbers → number. Any operand `null` → `null`. `/` or `%` by zero → `null`. A non-finite result (overflow, `(-8)^(1/3)`) → `null`. `+` on two strings concatenates. Any other operand type → **type error** |
| `%` | Remainder with the sign of the dividend (`-7 % 3 = -1`) |
| `==`, `!=` | Never errors. Equal when same type and same value; `null == null` is `true`; `1 == "1"` is `false`; numbers compare by value. Lists are equal when same length and pairwise equal |
| `< <= > >=` | Both numbers, or both strings (code-point order). If either operand is `null` → `false`. Mixed types → type error |
| `and`, `or` | Short-circuit. Operands are tested for truthiness: only `true` is true; everything else (incl. `null`, `0`, `""`) is false. Result is always a bool |
| `not` | `true` → `false`; anything else → `true` |
| Unknown identifier | Evaluation error (schema validation prevents this) |
| Unknown function / wrong arity | Evaluation error |

**Type errors and evaluation errors** make the whole expression evaluate to `null` in
form evaluation (calculated field becomes `null`; a `visible_if` that errors is treated
as `false`). `spec/expr-cases.json` marks such cases as `{"error": true}` so both engines
agree on *where* errors arise.

### Functions

Variadic aggregate functions (`sum`, `avg`, `mean`, `min`, `max`, `count`) require at
least one argument, flatten list arguments one level and **skip nulls**. A remaining
argument that is not a number (bool, string) is a type error, except in `count`, which
counts any non-null value.

**Unknown function names and wrong argument counts are parse errors** (static), so schema
validation catches them. Unknown identifiers are evaluation errors, and schema validation
rejects them by checking references.

| Function | Result |
|---|---|
| `sum(x, ...)` | Sum of non-null numbers; `null` if none are non-null |
| `avg(x, ...)` / `mean(x, ...)` | Mean of non-null numbers; `null` if none |
| `min(x, ...)`, `max(x, ...)` | Min / max of non-null numbers; `null` if none |
| `count(x, ...)` | Number of non-null values (after flattening). `count(list)` is its length |
| `round(x)`, `round(x, d)` | `sign(x) * floor(abs(x) * 10^d + 0.5) / 10^d` in doubles, `d` default 0; `d` must be an integer 0–10, else type error |
| `floor(x)`, `ceil(x)`, `abs(x)`, `sqrt(x)`, `ln(x)`, `log10(x)`, `exp(x)` | Usual meaning; `null` in → `null` out; domain errors (`sqrt(-1)`, `ln(0)`) → `null` |
| `pow(x, y)` | Same as `x ^ y` |
| `clamp(x, lo, hi)` | `min(max(x, lo), hi)`; `null` if `x` is `null` |
| `if(c, a, b)` | `a` if `c` is truthy (`true`), else `b`. Lazy: only the chosen branch is evaluated |
| `coalesce(x, ...)` | First non-null argument, else `null`. Lazy left to right |
| `isnull(x)` | `true` if `x` is `null` |
| `contains(list, v)` | `true` if `list` contains `v` (by `==`); `false` if `list` is `null`. Non-list first argument → type error |
| `len(x)` | Length of a string or list; `null` → `0` |

All numbers are doubles: `1` and `1.0` are the same value, and an integer result from
Python must equal the double the TypeScript engine produces. String order is by code
point (UTF-16 code unit order is acceptable; spec cases use ASCII).

Arity: `round` 1–2, `pow` 2, `clamp` 3, `if` 3, `contains` 2, `len` 1, single-argument
math functions 1, `coalesce` ≥ 1, aggregates ≥ 1.

### Clarifications (pinned by spec cases)

- Null propagation is checked before types: `null + 'a'` is `null`, not a type error.
- `round(null, d)` is `null`; a `null` or non-integer `d` with a non-null `x` is a type error.
- `clamp` ignores a `null` bound (`clamp(15, null, 10) = 10`); a list argument is a type error.
- `-0` results are normalised to `0`.
- A bare function name (`sum`) is an identifier, not a call; it never resolves, so it is an
  evaluation error and an unknown reference in schema validation.
- Escapes other than `\" \' \\ \n \t` are parse errors.
- `len` and `max_length` count Unicode code points; strings order by code point.
- `visible_if: ""` is a parse error (schema validation reports it; evaluation hides the field).

## Form evaluation

`evaluate(schema, values) -> { visible, computed, values }` is defined by this algorithm
(both engines implement it literally):

```
input   = values restricted to keys of non-calculated, value-holding fields
          ("" and [] are treated as null)
hidden  = {}                                     # set of hidden field keys
repeat at most (number_of_fields + 1) times:
    env = {}
    for each non-calculated value field f:       env[f] = null if f in hidden else input[f]
    for each calculated field c, in topological order of references (ties: schema order):
        env[c] = null if c in hidden else round_decimals(eval(c.expression, env), c.decimals)
                                                  # evaluation error -> null
    new_hidden = { f : f's section visible_if is present and eval(..., env) is not true,
                       or f's own visible_if is present and eval(..., env) is not true }
                                                  # evaluation error -> not true -> hidden
    if new_hidden == hidden: break
    hidden = new_hidden
visible  = { field key -> not in hidden }        # includes info and calculated fields
computed = { c -> env[c] for each calculated field }   # hidden -> null
values   = { f -> input[f] for each non-calculated value field not in hidden and not null }
```

`round_decimals(x, d)`: when `d` is set and `x` is a number,
`sign(x) * floor(abs(x) * 10^d + 0.5) / 10^d` computed in doubles; otherwise `x` unchanged.
Downstream expressions see the rounded value. `round(x, d)` in the language uses the same
formula.

`decimals` on a `number` field is a display and input-step hint only; extra precision is
not rejected.

`validate(schema, values) -> { ok, errors, values, computed }` runs `evaluate`, then:

- Each key in the raw input that is not a field in the schema, or is an `info` field →
  `"unknown_field"`. Keys of `calculated` fields are silently ignored (the server
  recomputes them).
- Each **visible** non-calculated value field, first failing check wins, in this order:
  1. `required` and value is `null`/absent/`""`/`[]` → `"required"` (a value that is
     absent and not required skips the remaining checks)
  2. wrong JSON type → `"invalid_type"` (`number`/`scale`/`duration`: number, not bool;
     `select`: string or number; `multiselect`: array; `boolean`: bool; `text`/`textarea`/
     `date`/`time`/`datetime`: string)
  3. `date` not `YYYY-MM-DD` (and a real calendar date), `time` not `HH:MM` (00–23, 00–59),
     `datetime` not matching
     `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$` with a real
     date and time → `"invalid_format"`
  4. `select` value not among option values (by `==`) → `"invalid_option"`;
     `multiselect` with any element not among options, or with duplicates →
     `"invalid_option"`
  5. `scale` not on the grid: `(value - min) / step` is not within 1e-9 of an integer
     (any integer, so a value below `min` passes this check and fails the next) →
     `"invalid_step"`
  6. `number`/`scale`/`duration` below `min` or above `max`; `date` before `min` or after
     `max`; `multiselect` length outside `min_selected`/`max_selected` → `"out_of_range"`
  7. `text`/`textarea` longer than `max_length` (default 500 / 5000, counted in Unicode
     code points) → `"too_long"`
- `ok` is true when `errors` is empty. `values` and `computed` are those of `evaluate`.

Errors are `{field_key: code}`. Hidden fields are never validated.

Server rule: client-supplied values for calculated fields are ignored and recomputed.
