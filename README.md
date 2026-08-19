# Tapziq Translate

Tapziq Translate is an offline English–Spanish translator for Android, built in plain
Java. Its translation vocabulary ships directly inside the app.

It requests no permissions and uses no translation API, model, network connection, or
runtime library.

## Build

Install JDK 21 and Android SDK 36, then make sure `JAVA_HOME` and `ANDROID_HOME`
point to those installations.

```sh
./gradlew --offline --no-daemon testDebugUnitTest lintDebug assembleDebug
```

The debug APK is written to `app/build/outputs/apk/debug/app-debug.apk`.
