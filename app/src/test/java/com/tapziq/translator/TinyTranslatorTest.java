package com.tapziq.translator;

import static com.tapziq.translator.TinyTranslator.Direction.ENGLISH_TO_SPANISH;
import static com.tapziq.translator.TinyTranslator.Direction.SPANISH_TO_ENGLISH;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class TinyTranslatorTest {
    private final TinyTranslator translator = new TinyTranslator();

    @Test
    public void translatesKnownPhraseAndPunctuation() {
        assertEquals("Gracias!", translator.translate("Thank you!", ENGLISH_TO_SPANISH));
    }

    @Test
    public void prefersLongestPhraseThenContinuesWithWords() {
        assertEquals(
                "Buenos días, amigo.",
                translator.translate("Good morning, friend.", ENGLISH_TO_SPANISH)
        );
    }

    @Test
    public void preservesUppercasePhraseStyle() {
        assertEquals(
                "BUENOS DÍAS",
                translator.translate("GOOD MORNING", ENGLISH_TO_SPANISH)
        );
    }

    @Test
    public void translatesInReverse() {
        assertEquals("Thank you!", translator.translate("Gracias!", SPANISH_TO_ENGLISH));
        assertEquals("Good morning", translator.translate("Buenos días", SPANISH_TO_ENGLISH));
    }

    @Test
    public void leavesUnknownWordsAlone() {
        assertEquals(
                "Hola, Zorp!",
                translator.translate("Hello, Zorp!", ENGLISH_TO_SPANISH)
        );
        assertEquals("shelloworld", translator.translate("shelloworld", ENGLISH_TO_SPANISH));
    }

    @Test
    public void doesNotMatchPhraseAcrossPunctuation() {
        assertEquals(
                "good, morning",
                translator.translate("good, morning", ENGLISH_TO_SPANISH)
        );
        assertEquals(
                "Good\nmorning",
                translator.translate("Good\nmorning", ENGLISH_TO_SPANISH)
        );
    }

    @Test
    public void matchesPhraseAcrossRepeatedInlineWhitespace() {
        assertEquals(
                "Buenos días!",
                translator.translate("Good  \t morning!", ENGLISH_TO_SPANISH)
        );
    }

    @Test
    public void preservesWhitespaceAndNonWords() {
        assertEquals(
                "  hola\tamigo!  ",
                translator.translate("  hello\tfriend!  ", ENGLISH_TO_SPANISH)
        );
        assertEquals("...?!", translator.translate("...?!", ENGLISH_TO_SPANISH));
        assertEquals("", translator.translate("", ENGLISH_TO_SPANISH));
    }

    @Test
    public void handlesStraightAndCurlyApostrophes() {
        assertEquals("De nada.", translator.translate("You're welcome.", ENGLISH_TO_SPANISH));
        assertEquals("De nada.", translator.translate("You’re welcome.", ENGLISH_TO_SPANISH));
    }
}
