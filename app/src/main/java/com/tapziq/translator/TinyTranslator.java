package com.tapziq.translator;

import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Offline English-Spanish translation using vocabulary bundled with the app. */
public final class TinyTranslator {
    public enum Direction {
        ENGLISH_TO_SPANISH,
        SPANISH_TO_ENGLISH
    }

    private static final Pattern TOKEN_PATTERN = Pattern.compile(
            "[\\p{L}\\p{M}]+(?:['’][\\p{L}\\p{M}]+)?|[^\\p{L}\\p{M}]+"
    );
    private static final Pattern WORD_PATTERN = Pattern.compile(
            "[\\p{L}\\p{M}]+(?:['’][\\p{L}\\p{M}]+)?"
    );

    private static final Map<String, String> ENGLISH_WORDS = wordMap(new String[][]{
            {"hello", "hola"},
            {"hi", "hola"},
            {"goodbye", "adiós"},
            {"please", "por favor"},
            {"thanks", "gracias"},
            {"yes", "sí"},
            {"no", "no"},
            {"friend", "amigo"},
            {"water", "agua"},
            {"food", "comida"},
            {"house", "casa"},
            {"bathroom", "baño"},
            {"book", "libro"},
            {"cat", "gato"},
            {"dog", "perro"},
            {"red", "rojo"},
            {"blue", "azul"},
            {"green", "verde"},
            {"big", "grande"},
            {"small", "pequeño"},
            {"today", "hoy"},
            {"tomorrow", "mañana"},
            {"where", "dónde"},
            {"what", "qué"},
            {"who", "quién"},
            {"when", "cuándo"},
            {"why", "por qué"},
            {"how", "cómo"},
            {"coffee", "café"},
            {"tea", "té"},
            {"milk", "leche"},
            {"bread", "pan"},
            {"school", "escuela"},
            {"car", "coche"},
            {"left", "izquierda"},
            {"right", "derecha"},
            {"help", "ayuda"},
            {"open", "abierto"},
            {"closed", "cerrado"},
            {"one", "uno"},
            {"two", "dos"},
            {"three", "tres"}
    });

    private static final Map<String, String> SPANISH_WORDS = wordMap(new String[][]{
            {"hola", "hello"},
            {"adiós", "goodbye"},
            {"sí", "yes"},
            {"no", "no"},
            {"amigo", "friend"},
            {"agua", "water"},
            {"comida", "food"},
            {"casa", "house"},
            {"baño", "bathroom"},
            {"libro", "book"},
            {"gato", "cat"},
            {"perro", "dog"},
            {"rojo", "red"},
            {"azul", "blue"},
            {"verde", "green"},
            {"grande", "big"},
            {"pequeño", "small"},
            {"hoy", "today"},
            {"mañana", "tomorrow"},
            {"dónde", "where"},
            {"qué", "what"},
            {"quién", "who"},
            {"cuándo", "when"},
            {"cómo", "how"},
            {"café", "coffee"},
            {"té", "tea"},
            {"leche", "milk"},
            {"pan", "bread"},
            {"escuela", "school"},
            {"coche", "car"},
            {"izquierda", "left"},
            {"derecha", "right"},
            {"ayuda", "help"},
            {"abierto", "open"},
            {"cerrado", "closed"},
            {"uno", "one"},
            {"dos", "two"},
            {"tres", "three"}
    });

    private static final List<Phrase> ENGLISH_PHRASES = phraseList(new String[][]{
            {"good morning", "buenos días"},
            {"good afternoon", "buenas tardes"},
            {"good night", "buenas noches"},
            {"thank you", "gracias"},
            {"you're welcome", "de nada"},
            {"you are welcome", "de nada"},
            {"how are you", "cómo estás"},
            {"i am fine", "estoy bien"},
            {"my name is", "me llamo"},
            {"where is the bathroom", "dónde está el baño"},
            {"i don't understand", "no entiendo"},
            {"i do not understand", "no entiendo"},
            {"do you speak english", "hablas inglés"},
            {"see you later", "hasta luego"}
    });

    private static final List<Phrase> SPANISH_PHRASES = phraseList(new String[][]{
            {"buenos días", "good morning"},
            {"buenas tardes", "good afternoon"},
            {"buenas noches", "good night"},
            {"gracias", "thank you"},
            {"por favor", "please"},
            {"de nada", "you're welcome"},
            {"cómo estás", "how are you"},
            {"estoy bien", "i am fine"},
            {"me llamo", "my name is"},
            {"dónde está el baño", "where is the bathroom"},
            {"no entiendo", "i don't understand"},
            {"hablas inglés", "do you speak english"},
            {"hasta luego", "see you later"},
            {"por qué", "why"}
    });

    public String translate(String text, Direction direction) {
        if (text == null || text.isEmpty()) {
            return text == null ? "" : text;
        }
        if (direction == null) {
            throw new IllegalArgumentException("direction is required");
        }

        List<String> tokens = tokenize(text);
        Map<String, String> words = direction == Direction.ENGLISH_TO_SPANISH
                ? ENGLISH_WORDS : SPANISH_WORDS;
        List<Phrase> phrases = direction == Direction.ENGLISH_TO_SPANISH
                ? ENGLISH_PHRASES : SPANISH_PHRASES;
        StringBuilder translated = new StringBuilder(text.length());

        int index = 0;
        while (index < tokens.size()) {
            String token = tokens.get(index);
            if (!isWord(token)) {
                translated.append(token);
                index++;
                continue;
            }

            boolean phraseMatched = false;
            for (Phrase phrase : phrases) {
                int phraseEnd = phrase.matchEnd(tokens, index);
                if (phraseEnd >= 0) {
                    String source = join(tokens, index, phraseEnd);
                    translated.append(applyCase(phrase.translation, source));
                    index = phraseEnd;
                    phraseMatched = true;
                    break;
                }
            }
            if (phraseMatched) {
                continue;
            }

            String replacement = words.get(normalize(token));
            translated.append(replacement == null ? token : applyCase(replacement, token));
            index++;
        }
        return translated.toString();
    }

    private static List<String> tokenize(String text) {
        List<String> tokens = new ArrayList<>();
        Matcher matcher = TOKEN_PATTERN.matcher(text);
        while (matcher.find()) {
            tokens.add(matcher.group());
        }
        return tokens;
    }

    private static String join(List<String> tokens, int start, int end) {
        StringBuilder result = new StringBuilder();
        for (int index = start; index < end; index++) {
            result.append(tokens.get(index));
        }
        return result.toString();
    }

    private static boolean isWord(String value) {
        return WORD_PATTERN.matcher(value).matches();
    }

    private static boolean isInlineWhitespace(String value) {
        if (value.isEmpty()) {
            return false;
        }
        for (int offset = 0; offset < value.length(); ) {
            int codePoint = value.codePointAt(offset);
            if (codePoint == '\n'
                    || codePoint == '\r'
                    || codePoint == 0x0085
                    || codePoint == 0x2028
                    || codePoint == 0x2029
                    || (!Character.isWhitespace(codePoint)
                    && Character.getType(codePoint) != Character.SPACE_SEPARATOR)) {
                return false;
            }
            offset += Character.charCount(codePoint);
        }
        return true;
    }

    private static String normalize(String value) {
        return Normalizer.normalize(value.replace('’', '\''), Normalizer.Form.NFC)
                .toLowerCase(Locale.ROOT);
    }

    private static String applyCase(String translation, String source) {
        int letterCount = 0;
        boolean allUppercase = true;
        boolean firstUppercase = false;
        boolean restLowercase = true;

        for (int offset = 0; offset < source.length(); ) {
            int codePoint = source.codePointAt(offset);
            offset += Character.charCount(codePoint);
            if (!Character.isLetter(codePoint)) {
                continue;
            }
            if (letterCount == 0) {
                firstUppercase = Character.isUpperCase(codePoint);
            } else if (!Character.isLowerCase(codePoint)) {
                restLowercase = false;
            }
            if (!Character.isUpperCase(codePoint)) {
                allUppercase = false;
            }
            letterCount++;
        }

        if (letterCount > 1 && allUppercase) {
            return translation.toUpperCase(Locale.ROOT);
        }
        if (firstUppercase && restLowercase) {
            return capitalizeFirstLetter(translation);
        }
        return translation;
    }

    private static String capitalizeFirstLetter(String value) {
        for (int offset = 0; offset < value.length(); ) {
            int codePoint = value.codePointAt(offset);
            int width = Character.charCount(codePoint);
            if (Character.isLetter(codePoint)) {
                String first = value.substring(offset, offset + width).toUpperCase(Locale.ROOT);
                return value.substring(0, offset) + first + value.substring(offset + width);
            }
            offset += width;
        }
        return value;
    }

    private static Map<String, String> wordMap(String[][] entries) {
        Map<String, String> result = new LinkedHashMap<>();
        for (String[] entry : entries) {
            result.put(normalize(entry[0]), entry[1]);
        }
        return Collections.unmodifiableMap(result);
    }

    private static List<Phrase> phraseList(String[][] entries) {
        List<Phrase> result = new ArrayList<>();
        for (String[] entry : entries) {
            result.add(new Phrase(entry[0], entry[1]));
        }
        Collections.sort(result, new Comparator<Phrase>() {
            @Override
            public int compare(Phrase left, Phrase right) {
                return Integer.compare(right.wordCount(), left.wordCount());
            }
        });
        return Collections.unmodifiableList(result);
    }

    private static final class Phrase {
        private final String[] words;
        private final String translation;

        private Phrase(String source, String translation) {
            this.words = normalize(source).split(" ");
            this.translation = translation;
        }

        private int wordCount() {
            return words.length;
        }

        private int matchEnd(List<String> tokens, int start) {
            int cursor = start;
            for (int wordIndex = 0; wordIndex < words.length; wordIndex++) {
                if (cursor >= tokens.size()
                        || !isWord(tokens.get(cursor))
                        || !words[wordIndex].equals(normalize(tokens.get(cursor)))) {
                    return -1;
                }
                if (wordIndex < words.length - 1) {
                    if (cursor + 2 >= tokens.size()
                            || !isInlineWhitespace(tokens.get(cursor + 1))) {
                        return -1;
                    }
                    cursor += 2;
                }
            }
            return cursor + 1;
        }
    }
}
