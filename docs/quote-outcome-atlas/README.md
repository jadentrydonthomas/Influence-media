# Quote Outcome Atlas

Offline, single-file management dashboard that turns Nucor Building Systems weekly
quote books and order-log exports into a quote-to-order outcome view.

| Path | What it is |
| --- | --- |
| `app/quote-conversion-atlas-shareable.html` | The deliverable. One self-contained file — open by double-click, no server, no network. |
| `QUOTE_OUTCOME_ATLAS_HANDOFF_SPEC.md` | Product and engineering contract (v2.0). |
| `handoff-spec.html` | Designed reading version of the same spec. |
| `fixtures/` | Real Week 1–3 2026 quote books and `OrderLog_1-10.xlsx`, used by the tests. |
| `test/regression.mjs` | Drives the real dashboard in Chromium against the fixtures and asserts the baseline. |

## Running the regression suite

```bash
npm install
node test/regression.mjs
```

29 assertions cover the core outcome figures, the data-quality exceptions, coverage
labelling, and the exported deck. Spec `T-16` requires these to stay green after any
change to parsing, joins, ownership, exposure, or metrics.

Set `CHROME_PATH` if your Chromium lives somewhere other than the default.

## Fixture baseline (Weeks 1–3 + OrderLog 1-10, 30+ day exposure)

| Check | Value |
| --- | --- |
| Quote rows → opportunities | 184 → 174 |
| Quote wins / booked jobs | 23 / 24 |
| Conversion | 13.2% |
| Quoted value | $150.1M |
| Order rows | 160 (72 blank `Quote #`, 1 non-standard, 87 parsable) |
| Order-log cutoff | 13 Mar 2026 |
| On-time scored | 48 of 174 (28% coverage) |

These reproduce the full Week 1–10 baseline behaviour in §12 of the spec: the same
72/1/87 split of order rows and the same single non-standard reference
(`P-0287-025-2`).

## Notes for the next engineer

- Quote ownership always comes from the weekly workbook (`SCHR` / `ENGR.` / `CHK`).
  Order-log roles are linked-job context only and must never overwrite it.
- `Week 2 - 2026.xlsm` carries a wrong Monday year (2025). The parser recovers it from
  the filename sequence and reports the correction — do not "fix" this by trusting the
  cell.
- The `Inventory` sheet holds four separate blocks. Only `Estimator List` and
  `Engineer List` are Name/Initials. The top block is Name/**Territory** and must not be
  read as initials.
- On-time release is scored on a minority of records. Any new surface that shows it
  must carry the denominator.
