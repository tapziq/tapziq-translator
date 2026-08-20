package com.tapziq.translator;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final int PAGE_COLOR = Color.rgb(246, 247, 249);
    private static final int TEXT_COLOR = Color.rgb(28, 31, 38);
    private static final int MUTED_COLOR = Color.rgb(91, 98, 112);
    private static final String STATE_DIRECTION = "direction";
    private static final String STATE_INPUT = "input";
    private static final String STATE_OUTPUT = "output";

    private final TinyTranslator translator = new TinyTranslator();
    private ProcessTextRequest processTextRequest = ProcessTextRequest.launcher();
    private TinyTranslator.Direction direction = TinyTranslator.Direction.ENGLISH_TO_SPANISH;
    private EditText input;
    private TextView inputLabel;
    private TextView output;
    private TextView outputLabel;
    private Button directionButton;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        processTextRequest = readProcessTextRequest(getIntent());
        if (processTextRequest.isProcessText()) {
            setResult(RESULT_CANCELED);
        }
        setContentView(buildContent());
        configureSystemBars();
        if (savedInstanceState != null) {
            direction = savedInstanceState.getBoolean(STATE_DIRECTION)
                    ? TinyTranslator.Direction.SPANISH_TO_ENGLISH
                    : TinyTranslator.Direction.ENGLISH_TO_SPANISH;
            input.setText(savedInstanceState.getString(STATE_INPUT, ""));
            output.setText(savedInstanceState.getString(STATE_OUTPUT, ""));
            updateDirectionLabels();
        } else if (processTextRequest.isProcessText()) {
            input.setText(processTextRequest.initialText());
            input.setSelection(input.length());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        outState.putBoolean(
                STATE_DIRECTION,
                direction == TinyTranslator.Direction.SPANISH_TO_ENGLISH
        );
        outState.putString(STATE_INPUT, input.getText().toString());
        outState.putString(STATE_OUTPUT, output.getText().toString());
        super.onSaveInstanceState(outState);
    }

    private View buildContent() {
        ScrollView scrollView = new ScrollView(this);
        scrollView.setFillViewport(true);
        scrollView.setBackgroundColor(PAGE_COLOR);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_HORIZONTAL);
        applySafePadding(content);
        scrollView.addView(content, new ScrollView.LayoutParams(
                ScrollView.LayoutParams.MATCH_PARENT,
                ScrollView.LayoutParams.WRAP_CONTENT
        ));

        TextView title = text(getString(R.string.app_name), 28, TEXT_COLOR);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        content.addView(title, fullWidth(0));

        TextView subtitle = text(getString(R.string.subtitle), 14, MUTED_COLOR);
        content.addView(subtitle, fullWidth(8));

        directionButton = new Button(this);
        directionButton.setAllCaps(false);
        directionButton.setTextSize(16);
        directionButton.setOnClickListener(view -> toggleDirection());
        content.addView(directionButton, fullWidth(24));

        inputLabel = text(getString(R.string.english), 14, MUTED_COLOR);
        inputLabel.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        content.addView(inputLabel, fullWidth(20));

        input = new EditText(this);
        input.setId(R.id.translation_input);
        input.setGravity(Gravity.TOP | Gravity.START);
        input.setMinLines(4);
        input.setTextSize(18);
        input.setTextColor(TEXT_COLOR);
        input.setHintTextColor(MUTED_COLOR);
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        input.setBackground(panelBackground());
        content.addView(input, fixedHeight(130, 8));

        Button translateButton = new Button(this);
        translateButton.setId(R.id.translate_button);
        translateButton.setText(processTextRequest.canReturnTranslation()
                ? R.string.translate_and_return
                : R.string.translate);
        translateButton.setTextSize(17);
        translateButton.setAllCaps(false);
        translateButton.setOnClickListener(view -> translate());
        content.addView(translateButton, fullWidth(16));

        outputLabel = text(getString(R.string.spanish), 14, MUTED_COLOR);
        outputLabel.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        content.addView(outputLabel, fullWidth(20));

        output = text("", 18, TEXT_COLOR);
        output.setId(R.id.translation_output);
        output.setGravity(Gravity.TOP | Gravity.START);
        output.setTextIsSelectable(true);
        output.setPadding(dp(14), dp(12), dp(14), dp(12));
        output.setBackground(panelBackground());
        output.setMinHeight(dp(120));
        content.addView(output, fullWidth(8));

        TextView privacy = text(getString(R.string.on_device), 12, MUTED_COLOR);
        content.addView(privacy, fullWidth(14));

        updateDirectionLabels();
        return scrollView;
    }

    private void translate() {
        String source = input.getText().toString();
        if (source.trim().isEmpty()) {
            input.setError(getString(R.string.enter_text_error));
            output.setText("");
            return;
        }
        input.setError(null);
        String translated = translator.translate(source, direction);
        if (processTextRequest.canReturnTranslation()) {
            Intent result = new Intent()
                    .putExtra(Intent.EXTRA_PROCESS_TEXT, translated);
            setResult(RESULT_OK, result);
            finish();
            return;
        }
        output.setText(translated);
    }

    private static ProcessTextRequest readProcessTextRequest(Intent intent) {
        if (intent == null || !Intent.ACTION_PROCESS_TEXT.equals(intent.getAction())) {
            return ProcessTextRequest.launcher();
        }

        CharSequence suppliedText;
        Boolean readOnly = null;
        try {
            suppliedText = intent.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
            if (intent.hasExtra(Intent.EXTRA_PROCESS_TEXT_READONLY)) {
                readOnly = intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true);
            }
        } catch (RuntimeException malformedExtras) {
            suppliedText = null;
        }
        return ProcessTextRequest.processText(suppliedText, readOnly);
    }

    private void toggleDirection() {
        String previousInput = input.getText().toString();
        String previousOutput = output.getText().toString();
        direction = direction == TinyTranslator.Direction.ENGLISH_TO_SPANISH
                ? TinyTranslator.Direction.SPANISH_TO_ENGLISH
                : TinyTranslator.Direction.ENGLISH_TO_SPANISH;
        if (previousOutput.isEmpty()) {
            output.setText("");
        } else {
            input.setText(previousOutput);
            input.setSelection(previousOutput.length());
            output.setText(previousInput);
        }
        updateDirectionLabels();
    }

    private void updateDirectionLabels() {
        boolean toSpanish = direction == TinyTranslator.Direction.ENGLISH_TO_SPANISH;
        directionButton.setText(toSpanish
                ? R.string.english_to_spanish
                : R.string.spanish_to_english);
        inputLabel.setText(toSpanish ? R.string.english : R.string.spanish);
        outputLabel.setText(toSpanish ? R.string.spanish : R.string.english);
        input.setHint(toSpanish ? R.string.enter_english : R.string.enter_spanish);
    }

    private TextView text(String value, int sizeSp, int color) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sizeSp);
        view.setTextColor(color);
        return view;
    }

    private LinearLayout.LayoutParams fullWidth(int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.topMargin = dp(topMarginDp);
        return params;
    }

    private LinearLayout.LayoutParams fixedHeight(int heightDp, int topMarginDp) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                dp(heightDp)
        );
        params.topMargin = dp(topMarginDp);
        return params;
    }

    private GradientDrawable panelBackground() {
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(10));
        background.setStroke(dp(1), Color.rgb(214, 218, 226));
        return background;
    }

    @SuppressWarnings("deprecation")
    private void configureSystemBars() {
        getWindow().setStatusBarColor(PAGE_COLOR);
        getWindow().setNavigationBarColor(
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? PAGE_COLOR : Color.BLACK
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(lightBars, lightBars);
            }
            return;
        }
        int flags = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }

    private void applySafePadding(LinearLayout content) {
        final int horizontal = dp(20);
        final int vertical = dp(16);
        content.setPadding(horizontal, vertical, horizontal, vertical);
        content.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            int left;
            int top;
            int right;
            int bottom;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Insets bars = windowInsets.getInsets(
                        WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                );
                left = bars.left;
                top = bars.top;
                right = bars.right;
                bottom = bars.bottom;
            } else {
                left = windowInsets.getSystemWindowInsetLeft();
                top = windowInsets.getSystemWindowInsetTop();
                right = windowInsets.getSystemWindowInsetRight();
                bottom = windowInsets.getSystemWindowInsetBottom();
            }
            view.setPadding(
                    horizontal + left,
                    vertical + top,
                    horizontal + right,
                    vertical + bottom
            );
            return windowInsets;
        });
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
