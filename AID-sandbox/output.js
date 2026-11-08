// ============================================================================
// Output Modifier (AID-sandbox/output.js)
//
// Paste this entire file into your scenario's "Output" tab.
// Defensive fallback to prevent unwanted LLM text if context was bypassed.
// Requires: library-sandbox.js in the "Library" tab.
// ============================================================================
const modifier = (text) => {
    // If running alongside Auto-Cards or other scripts in RUN ORDER:
    // text = AutoCards("output", text);

    if (typeof GetoptSandbox === "function") {
        text = GetoptSandbox("output", text);
    }
    return { text };
};
modifier(text);
