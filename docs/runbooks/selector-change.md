# Selector change runbook

When selector drift is detected:

1. Preserve the failing fixture.
2. Add a new fixture representing the changed markup.
3. Update selectors and parser tests.
4. Run the connector contract tests.
5. Review the change before enabling the connector again.
