package com.tapziq.translator;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class ProcessTextRequestTest {
    @Test
    public void launcherModeDoesNotPrefillOrReturnText() {
        ProcessTextRequest request = ProcessTextRequest.launcher();

        assertFalse(request.isProcessText());
        assertFalse(request.canReturnTranslation());
        assertEquals("", request.initialText());
    }

    @Test
    public void missingReadOnlyExtraDefaultsToReadOnly() {
        ProcessTextRequest request = ProcessTextRequest.processText("Hello", null);

        assertTrue(request.isProcessText());
        assertFalse(request.canReturnTranslation());
        assertEquals("Hello", request.initialText());
    }

    @Test
    public void explicitReadOnlyRequestCannotReturnAMutation() {
        ProcessTextRequest request = ProcessTextRequest.processText("Hello", true);

        assertTrue(request.isProcessText());
        assertFalse(request.canReturnTranslation());
    }

    @Test
    public void explicitMutableRequestCanReturnTranslation() {
        ProcessTextRequest request = ProcessTextRequest.processText(
                new StringBuilder("Hello world"),
                false
        );

        assertTrue(request.isProcessText());
        assertTrue(request.canReturnTranslation());
        assertEquals("Hello world", request.initialText());
    }

    @Test
    public void missingProcessTextPayloadBecomesEmptyText() {
        ProcessTextRequest request = ProcessTextRequest.processText(null, false);

        assertTrue(request.canReturnTranslation());
        assertEquals("", request.initialText());
    }
}
