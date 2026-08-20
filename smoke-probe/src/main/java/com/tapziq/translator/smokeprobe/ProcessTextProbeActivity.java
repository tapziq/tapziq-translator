package com.tapziq.translator.smokeprobe;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;

/** Test-only Activity that makes a real mutable Process Text request and exposes its result. */
public final class ProcessTextProbeActivity extends Activity {
    private static final int PROCESS_TEXT_REQUEST = 1;
    private static final String TRANSLATOR_PACKAGE = "com.tapziq.translator";

    private TextView resultView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_process_text_probe);
        resultView = findViewById(R.id.process_text_result);
        if (savedInstanceState == null) {
            launchTranslator();
        }
    }

    private void launchTranslator() {
        Intent request = new Intent(Intent.ACTION_PROCESS_TEXT)
                .setPackage(TRANSLATOR_PACKAGE)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_PROCESS_TEXT, "Hello")
                .putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false)
                .addCategory(Intent.CATEGORY_DEFAULT);
        try {
            startActivityForResult(request, PROCESS_TEXT_REQUEST);
        } catch (ActivityNotFoundException error) {
            resultView.setText(R.string.activity_not_found);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PROCESS_TEXT_REQUEST) {
            return;
        }
        if (resultCode != RESULT_OK || data == null) {
            resultView.setText(getString(R.string.wrong_result_code, resultCode));
            return;
        }
        CharSequence translated = data.getCharSequenceExtra(Intent.EXTRA_PROCESS_TEXT);
        resultView.setText(getString(R.string.successful_result, translated));
    }
}
