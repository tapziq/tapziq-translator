package com.tapziq.translator;

/** Immutable, Android-free state for one Process Text request. */
final class ProcessTextRequest {
    private static final ProcessTextRequest LAUNCHER = new ProcessTextRequest(false, true, "");

    private final boolean processText;
    private final boolean readOnly;
    private final String initialText;

    private ProcessTextRequest(boolean processText, boolean readOnly, String initialText) {
        this.processText = processText;
        this.readOnly = readOnly;
        this.initialText = initialText;
    }

    static ProcessTextRequest launcher() {
        return LAUNCHER;
    }

    static ProcessTextRequest processText(CharSequence suppliedText, Boolean readOnlyExtra) {
        boolean readOnly = readOnlyExtra == null || readOnlyExtra;
        return new ProcessTextRequest(
                true,
                readOnly,
                suppliedText == null ? "" : suppliedText.toString()
        );
    }

    boolean isProcessText() {
        return processText;
    }

    boolean canReturnTranslation() {
        return processText && !readOnly;
    }

    String initialText() {
        return initialText;
    }
}
