"""Expression language from docs/FORMS.md: lexer, parser and evaluator.

The language is small and total. Values are ``float`` (every number is a double),
``str``, ``bool``, ``None`` and ``list`` (only from multiselect values). Parse errors
(including unknown functions and wrong arity) raise :class:`ParseError`; type errors and
unknown identifiers raise :class:`EvalError` at evaluation time.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from typing import Any

KEYWORDS = frozenset({"and", "or", "not", "true", "false", "null"})

# name -> (min_args, max_args or None for variadic)
FUNCTIONS: dict[str, tuple[int, int | None]] = {
    "sum": (1, None),
    "avg": (1, None),
    "mean": (1, None),
    "min": (1, None),
    "max": (1, None),
    "count": (1, None),
    "round": (1, 2),
    "floor": (1, 1),
    "ceil": (1, 1),
    "abs": (1, 1),
    "sqrt": (1, 1),
    "ln": (1, 1),
    "log10": (1, 1),
    "exp": (1, 1),
    "pow": (2, 2),
    "clamp": (3, 3),
    "if": (3, 3),
    "coalesce": (1, None),
    "isnull": (1, 1),
    "contains": (2, 2),
    "len": (1, 1),
}

RESERVED_WORDS = KEYWORDS | frozenset(FUNCTIONS)


class ParseError(Exception):
    """The expression text is not a valid expression."""


class EvalError(Exception):
    """Type error, unknown identifier or other evaluation error."""


Value = float | str | bool | list[Any] | None


# --------------------------------------------------------------------------- lexer


@dataclass(frozen=True, slots=True)
class Token:
    kind: str  # "num" | "str" | "ident" | "op" | "eof"
    value: Any
    pos: int


_TWO_CHAR_OPS = ("||", "&&", "==", "!=", "<=", ">=")
_ONE_CHAR_OPS = frozenset("<>+-*/%^!(),")
_ESCAPES = {'"': '"', "'": "'", "\\": "\\", "n": "\n", "t": "\t"}


def _is_digit(ch: str) -> bool:
    return "0" <= ch <= "9"


def _is_ident_start(ch: str) -> bool:
    return ("a" <= ch <= "z") or ch == "_"


def _is_ident_char(ch: str) -> bool:
    return _is_ident_start(ch) or _is_digit(ch)


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in " \t\r\n":
            i += 1
            continue
        start = i
        if _is_digit(ch) or (ch == "." and i + 1 < n and _is_digit(text[i + 1])):
            while i < n and _is_digit(text[i]):
                i += 1
            if i < n and text[i] == ".":
                i += 1
                if i >= n or not _is_digit(text[i]):
                    raise ParseError(f"invalid number at {start}")
                while i < n and _is_digit(text[i]):
                    i += 1
            if i < n and text[i] in "eE":
                i += 1
                if i < n and text[i] in "+-":
                    i += 1
                if i >= n or not _is_digit(text[i]):
                    raise ParseError(f"invalid exponent at {start}")
                while i < n and _is_digit(text[i]):
                    i += 1
            if i < n and (_is_ident_char(text[i]) or text[i] == "."):
                raise ParseError(f"invalid number at {start}")
            tokens.append(Token("num", float(text[start:i]), start))
            continue
        if ch in "'\"":
            quote = ch
            i += 1
            chars: list[str] = []
            while True:
                if i >= n:
                    raise ParseError(f"unterminated string at {start}")
                c = text[i]
                if c == "\\":
                    if i + 1 >= n or text[i + 1] not in _ESCAPES:
                        raise ParseError(f"invalid escape at {i}")
                    chars.append(_ESCAPES[text[i + 1]])
                    i += 2
                    continue
                if c == quote:
                    i += 1
                    break
                chars.append(c)
                i += 1
            tokens.append(Token("str", "".join(chars), start))
            continue
        if _is_ident_start(ch):
            while i < n and _is_ident_char(text[i]):
                i += 1
            if i < n and ("A" <= text[i] <= "Z"):
                raise ParseError(f"invalid identifier at {start}")
            tokens.append(Token("ident", text[start:i], start))
            continue
        two = text[i : i + 2]
        if two in _TWO_CHAR_OPS:
            tokens.append(Token("op", two, start))
            i += 2
            continue
        if ch in _ONE_CHAR_OPS:
            tokens.append(Token("op", ch, start))
            i += 1
            continue
        raise ParseError(f"unexpected character {ch!r} at {i}")
    tokens.append(Token("eof", None, n))
    return tokens


# --------------------------------------------------------------------------- AST


@dataclass(frozen=True, slots=True)
class Literal:
    value: Value


@dataclass(frozen=True, slots=True)
class Ident:
    name: str


@dataclass(frozen=True, slots=True)
class Unary:
    op: str  # "-" | "not"
    operand: Node


@dataclass(frozen=True, slots=True)
class Binary:
    op: str  # arithmetic, comparison, "and", "or"
    left: Node
    right: Node


@dataclass(frozen=True, slots=True)
class Call:
    name: str
    args: tuple[Node, ...]


Node = Literal | Ident | Unary | Binary | Call


# --------------------------------------------------------------------------- parser

_COMPARISON_OPS = frozenset({"==", "!=", "<", "<=", ">", ">="})


class _Parser:
    def __init__(self, tokens: list[Token]) -> None:
        self.tokens = tokens
        self.pos = 0

    @property
    def tok(self) -> Token:
        return self.tokens[self.pos]

    def advance(self) -> Token:
        tok = self.tokens[self.pos]
        self.pos += 1
        return tok

    def is_op(self, *ops: str) -> bool:
        return self.tok.kind == "op" and self.tok.value in ops

    def is_word(self, *words: str) -> bool:
        return self.tok.kind == "ident" and self.tok.value in words

    def expect_op(self, op: str) -> None:
        if not self.is_op(op):
            raise ParseError(f"expected {op!r} at {self.tok.pos}")
        self.advance()

    def parse(self) -> Node:
        node = self.parse_or()
        if self.tok.kind != "eof":
            raise ParseError(f"unexpected token at {self.tok.pos}")
        return node

    def parse_or(self) -> Node:
        node = self.parse_and()
        while self.is_op("||") or self.is_word("or"):
            self.advance()
            node = Binary("or", node, self.parse_and())
        return node

    def parse_and(self) -> Node:
        node = self.parse_not()
        while self.is_op("&&") or self.is_word("and"):
            self.advance()
            node = Binary("and", node, self.parse_not())
        return node

    def parse_not(self) -> Node:
        if self.is_op("!") or self.is_word("not"):
            self.advance()
            return Unary("not", self.parse_not())
        return self.parse_comparison()

    def parse_comparison(self) -> Node:
        node = self.parse_additive()
        if self.tok.kind == "op" and self.tok.value in _COMPARISON_OPS:
            op = self.advance().value
            node = Binary(op, node, self.parse_additive())
            if self.tok.kind == "op" and self.tok.value in _COMPARISON_OPS:
                raise ParseError(f"comparisons do not chain (at {self.tok.pos})")
        return node

    def parse_additive(self) -> Node:
        node = self.parse_multiplicative()
        while self.is_op("+", "-"):
            op = self.advance().value
            node = Binary(op, node, self.parse_multiplicative())
        return node

    def parse_multiplicative(self) -> Node:
        node = self.parse_unary()
        while self.is_op("*", "/", "%"):
            op = self.advance().value
            node = Binary(op, node, self.parse_unary())
        return node

    def parse_unary(self) -> Node:
        if self.is_op("-"):
            self.advance()
            return Unary("-", self.parse_unary())
        return self.parse_power()

    def parse_power(self) -> Node:
        base = self.parse_primary()
        if self.is_op("^"):
            self.advance()
            return Binary("^", base, self.parse_unary())
        return base

    def parse_primary(self) -> Node:
        tok = self.tok
        if tok.kind == "num":
            self.advance()
            return Literal(tok.value)
        if tok.kind == "str":
            self.advance()
            return Literal(tok.value)
        if tok.kind == "op" and tok.value == "(":
            self.advance()
            node = self.parse_or()
            self.expect_op(")")
            return node
        if tok.kind == "ident":
            name = tok.value
            if name == "true":
                self.advance()
                return Literal(True)
            if name == "false":
                self.advance()
                return Literal(False)
            if name == "null":
                self.advance()
                return Literal(None)
            if name in ("and", "or", "not"):
                raise ParseError(f"unexpected keyword {name!r} at {tok.pos}")
            self.advance()
            if self.is_op("("):
                return self.parse_call(name, tok.pos)
            return Ident(name)
        raise ParseError(f"unexpected token at {tok.pos}")

    def parse_call(self, name: str, pos: int) -> Node:
        if name not in FUNCTIONS:
            raise ParseError(f"unknown function {name!r} at {pos}")
        self.expect_op("(")
        args: list[Node] = []
        if not self.is_op(")"):
            args.append(self.parse_or())
            while self.is_op(","):
                self.advance()
                args.append(self.parse_or())
        self.expect_op(")")
        lo, hi = FUNCTIONS[name]
        if len(args) < lo or (hi is not None and len(args) > hi):
            raise ParseError(f"wrong number of arguments for {name}()")
        return Call(name, tuple(args))


def parse(text: str) -> Node:
    """Parse an expression. Raises ParseError."""
    if not isinstance(text, str):
        raise ParseError("expression must be a string")
    return _Parser(tokenize(text)).parse()


def identifiers(node: Node) -> set[str]:
    """Every identifier referenced by an expression (including inside lazy branches)."""
    found: set[str] = set()

    def walk(n: Node) -> None:
        match n:
            case Ident(name):
                found.add(name)
            case Unary(_, operand):
                walk(operand)
            case Binary(_, left, right):
                walk(left)
                walk(right)
            case Call(_, args):
                for a in args:
                    walk(a)
            case _:
                pass

    walk(node)
    return found


# --------------------------------------------------------------------------- values


def is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def normalize_value(v: Any) -> Value:
    """Convert an input value into the language's value domain (numbers become floats)."""
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, (list, tuple)):
        return [normalize_value(x) for x in v]
    raise EvalError(f"unsupported value type {type(v).__name__}")


def _finite(x: float) -> float | None:
    return x if math.isfinite(x) else None


def values_equal(a: Value, b: Value) -> bool:
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if is_number(a) and is_number(b):
        return float(a) == float(b)
    if isinstance(a, str) and isinstance(b, str):
        return a == b
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(values_equal(x, y) for x, y in zip(a, b, strict=True))
    return False


def round_half_away(x: float, d: int) -> float | None:
    """``sign(x) * floor(abs(x) * 10^d + 0.5) / 10^d`` in doubles."""
    scale = 10.0**d
    result = math.copysign(math.floor(abs(x) * scale + 0.5) / scale, x)
    if result == 0:
        result = 0.0
    return _finite(result)


def _power(a: float, b: float) -> float | None:
    try:
        return _finite(math.pow(a, b))
    except (OverflowError, ValueError, ZeroDivisionError):
        return None


def _arith(op: str, a: Value, b: Value) -> Value:
    if a is None or b is None:
        return None
    if op == "+" and isinstance(a, str) and isinstance(b, str):
        return a + b
    if not (is_number(a) and is_number(b)):
        raise EvalError(f"type error: {op} on {type(a).__name__} and {type(b).__name__}")
    x, y = float(a), float(b)
    if op == "+":
        return _finite(x + y)
    if op == "-":
        return _finite(x - y)
    if op == "*":
        return _finite(x * y)
    if op == "/":
        return None if y == 0 else _finite(x / y)
    if op == "%":
        return None if y == 0 else _finite(math.fmod(x, y))
    if op == "^":
        return _power(x, y)
    raise EvalError(f"unknown operator {op}")


def _compare(op: str, a: Value, b: Value) -> bool:
    if op == "==":
        return values_equal(a, b)
    if op == "!=":
        return not values_equal(a, b)
    if a is None or b is None:
        return False
    if is_number(a) and is_number(b):
        x: Any = float(a)
        y: Any = float(b)
    elif isinstance(a, str) and isinstance(b, str):
        x, y = a, b
    else:
        raise EvalError(f"type error: {op} on {type(a).__name__} and {type(b).__name__}")
    if op == "<":
        return x < y
    if op == "<=":
        return x <= y
    if op == ">":
        return x > y
    return x >= y


# --------------------------------------------------------------------------- evaluator


def _flatten(values: list[Value]) -> Iterator[Value]:
    for v in values:
        if isinstance(v, list):
            yield from v
        else:
            yield v


def _numbers(values: list[Value]) -> list[float]:
    out: list[float] = []
    for v in _flatten(values):
        if v is None:
            continue
        if not is_number(v):
            raise EvalError("type error: aggregate over non-number")
        out.append(float(v))
    return out


def _unary_math(fn: Callable[[float], float], x: Value) -> Value:
    if x is None:
        return None
    if not is_number(x):
        raise EvalError("type error: math function on non-number")
    try:
        return _finite(fn(float(x)))
    except (ValueError, OverflowError, ZeroDivisionError):
        return None


def _ln(x: float) -> float:
    return math.log(x)


_MATH_FUNCS: dict[str, Callable[[float], float]] = {
    "floor": lambda x: float(math.floor(x)),
    "ceil": lambda x: float(math.ceil(x)),
    "abs": abs,
    "sqrt": math.sqrt,
    "ln": _ln,
    "log10": math.log10,
    "exp": math.exp,
}


class _Evaluator:
    def __init__(self, env: Mapping[str, Any]) -> None:
        self.env = env

    def eval(self, node: Node) -> Value:
        match node:
            case Literal(value):
                return value
            case Ident(name):
                if name not in self.env:
                    raise EvalError(f"unknown identifier {name!r}")
                return normalize_value(self.env[name])
            case Unary("-", operand):
                v = self.eval(operand)
                if v is None:
                    return None
                if not is_number(v):
                    raise EvalError("type error: unary minus on non-number")
                return -float(v)
            case Unary("not", operand):
                return self.eval(operand) is not True
            case Binary("and", left, right):
                if self.eval(left) is not True:
                    return False
                return self.eval(right) is True
            case Binary("or", left, right):
                if self.eval(left) is True:
                    return True
                return self.eval(right) is True
            case Binary(op, left, right) if op in _COMPARISON_OPS:
                return _compare(op, self.eval(left), self.eval(right))
            case Binary(op, left, right):
                return _arith(op, self.eval(left), self.eval(right))
            case Call(name, args):
                return self.call(name, args)
        raise EvalError("invalid node")

    def call(self, name: str, args: tuple[Node, ...]) -> Value:
        if name == "if":
            return self.eval(args[1]) if self.eval(args[0]) is True else self.eval(args[2])
        if name == "coalesce":
            for a in args:
                v = self.eval(a)
                if v is not None:
                    return v
            return None
        vals = [self.eval(a) for a in args]
        if name == "sum":
            nums = _numbers(vals)
            return _finite(math.fsum(nums)) if nums else None
        if name in ("avg", "mean"):
            nums = _numbers(vals)
            return _finite(sum(nums) / len(nums)) if nums else None
        if name == "min":
            nums = _numbers(vals)
            return min(nums) if nums else None
        if name == "max":
            nums = _numbers(vals)
            return max(nums) if nums else None
        if name == "count":
            return float(sum(1 for v in _flatten(vals) if v is not None))
        if name == "round":
            x = vals[0]
            d: Value = vals[1] if len(vals) > 1 else 0.0
            if not is_number(d) or float(d) != math.floor(float(d)) or not (0 <= float(d) <= 10):
                raise EvalError("type error: round() digits must be an integer 0-10")
            if x is None:
                return None
            if not is_number(x):
                raise EvalError("type error: round() on non-number")
            return round_half_away(float(x), int(d))
        if name in _MATH_FUNCS:
            return _unary_math(_MATH_FUNCS[name], vals[0])
        if name == "pow":
            return _arith("^", vals[0], vals[1])
        if name == "clamp":
            x, lo, hi = vals
            for v in (x, lo, hi):
                if v is not None and not is_number(v):
                    raise EvalError("type error: clamp() on non-number")
            if x is None:
                return None
            result = float(x)
            if lo is not None:
                result = max(result, float(lo))
            if hi is not None:
                result = min(result, float(hi))
            return result
        if name == "isnull":
            return vals[0] is None
        if name == "contains":
            lst, needle = vals
            if lst is None:
                return False
            if not isinstance(lst, list):
                raise EvalError("type error: contains() needs a list")
            return any(values_equal(item, needle) for item in lst)
        if name == "len":
            x = vals[0]
            if x is None:
                return 0.0
            if isinstance(x, (str, list)):
                return float(len(x))
            raise EvalError("type error: len() needs a string or list")
        raise EvalError(f"unknown function {name!r}")


def evaluate(node: Node, env: Mapping[str, Any]) -> Value:
    """Evaluate a parsed expression. Raises EvalError on type errors / unknown identifiers."""
    try:
        return _Evaluator(env).eval(node)
    except RecursionError as exc:  # pathological nesting
        raise EvalError("expression too deeply nested") from exc


def evaluate_text(text: str, env: Mapping[str, Any] | None = None) -> Value:
    return evaluate(parse(text), env or {})
