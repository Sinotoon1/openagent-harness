# Changelog

## v1.0.0-candidate.9

This candidate release hardens caller-provided repair schema descriptors against dangerous object keys.

### Changed

- Caller-provided repair schema descriptors now reject dangerous path segments:
  - `__proto__`
  - `prototype`
  - `constructor`

### Covered

- Descriptor object field names.
- Nested descriptor fields.
- `required` paths.
- `pathStringFields`.
- `pathStringArrayFields`.

### Preserved

- Safe nested fields.
- Built-in schemas.
- Bounded candidate.8 descriptor behavior.
- Validate-then-repair behavior.
- Issue-path precise repair.
- Valid-input zero-touch.
- Sanitized MCP responses.
- Existing provider routing, streaming, telemetry, context compaction, and MCP tool names.

### Validation

- `npm test`: 8 test files passed, 85 tests passed.
- `npm run build`: passed.

### Known Caveat

- Dangerous-key rejection is segment-based, so dotted field names containing `constructor`, `prototype`, or `__proto__` as path segments are rejected conservatively.