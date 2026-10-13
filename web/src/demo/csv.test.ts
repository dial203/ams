import { describe, expect, it } from "vitest";
import { parseCsv, sniffDelimiter, writeCsv } from "./csv";

describe("parseCsv", () => {
  it("reads plain rows with LF or CRLF line ends", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\r\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quotes, doubled quotes, delimiters and line breaks inside quotes", () => {
    expect(parseCsv('name,note\n"Okafor, Maya","said ""hi""\nthen left"\n')).toEqual([
      ["name", "note"],
      ["Okafor, Maya", 'said "hi"\nthen left'],
    ]);
  });

  it("keeps empty cells and drops a BOM", () => {
    expect(parseCsv("﻿a,,c\n,,\n")).toEqual([
      ["a", "", "c"],
      ["", "", ""],
    ]);
  });

  it("uses another delimiter when asked", () => {
    expect(parseCsv("a;b\n1,5;2", ";")).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
  });
});

describe("sniffDelimiter", () => {
  it("picks the delimiter of the header line", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(sniffDelimiter("a;b;c\n1,5;2;3")).toBe(";");
    expect(sniffDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(sniffDelimiter("single")).toBe(",");
  });
});

describe("writeCsv", () => {
  it("quotes only cells that need it and round-trips through parseCsv", () => {
    const rows = [
      ["id", "name", "note"],
      ["1", "Okafor, Maya", 'a "quote"'],
      ["2", "Kim", "two\nlines"],
    ];
    const text = writeCsv(rows);
    expect(text).toBe('id,name,note\n1,"Okafor, Maya","a ""quote"""\n2,Kim,"two\nlines"\n');
    expect(parseCsv(text)).toEqual(rows);
  });
});
