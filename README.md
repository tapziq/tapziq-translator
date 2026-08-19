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

## Production releases

Production APKs are signed with the stable Tapziq release certificate, built from a
clean commit, and independently checked for their signature, package metadata,
permission set, embedded source revision, and alignment. The private signing key is
kept outside Git.

With the four `TAPZIQ_TRANSLATOR_RELEASE_*` signing variables set, build and verify
version 0.1.0 with:

```sh
scripts/build-production-release.sh 0.1.0 1
```

Published APKs and checksums are available from [GitHub Releases](../../releases).
The expected production certificate fingerprint is recorded in
`release/signing-certificate.sha256`.

## License

Tapziq Translate is available under the [Apache License 2.0](LICENSE).
