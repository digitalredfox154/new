# SAMAI v10 content audit

## Scope

The pass covers marketing copy, navigation, calls to action, form guidance, validation, success and error messages. Legal pages remain unchanged because legal precision takes priority over stylistic simplification.

## Editing standard

- one point per sentence;
- active verbs before abstract nouns;
- no unsupported claims, invented metrics or client stories;
- responsibility is named directly;
- most sentences stay within 18 words;
- generic AI and corporate filler is rejected in CI.

## Main corrections

- Replaced abstract phrases about “contours”, “functions” and “next steps” with tasks, owners and decisions.
- Split long service and FAQ explanations into shorter statements.
- Made scope boundaries direct: product and sales remain with the client; SAMAI owns only agreed work.
- Shortened form guidance and transport messages without weakening privacy or delivery meaning.
- Kept the editorial headlines that carry the visual concept, while rewriting the explanatory copy beneath them.

## Release gate

`tools/content_gate.py` parses the built landing, fails on sentences over 18 words and rejects a maintained list of AI/corporate filler patterns. The gate also scans dynamic copy in the JavaScript layers.
