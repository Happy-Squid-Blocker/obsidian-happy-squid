# Vendored files

These three are copied byte for byte out of Happy Squid's own source, where they
are maintained, so this plugin spells a figure exactly as the browser extension
and the phone apps do:

| file | what it is |
| ---- | ---------- |
| `day-key.ts` | the day a note names, as a date string rather than an instant |
| `format.ts` | how a task figure and a spendable budget are spelled |
| `hour12.ts` | how a time of day is spelled |

Each imports nothing at all, which is what makes carrying them over possible.
Edit them in Happy Squid rather than here; this copy is regenerated.
