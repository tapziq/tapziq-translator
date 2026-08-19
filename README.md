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

Stable releases are generated automatically from Conventional Commits on `main`.
The release bot persists the next SemVer version in source, builds with the permanent
Tapziq production certificate, independently verifies the APK, and exercises a real
English-to-Spanish translation on Android 16 before it can tag or publish anything.
The private signing key stays outside Git and pull-request jobs never receive it.

With the four `TAPZIQ_TRANSLATOR_RELEASE_*` file/credential variables set, a clean
source commit can be packaged with:

```sh
scripts/package-semantic-release.sh VERSION "$(git rev-parse HEAD)"
```

Every release contains the versioned production APK, checksums, license, and notices.
Published bytes are redownloaded and audited independently. See
[the release contract](docs/RELEASING.md) for version rules, failure recovery, and
repository controls. APKs are available from [GitHub Releases](../../releases); the
permanent certificate fingerprint is pinned in `release/signing-certificate.sha256`.

## License

Tapziq Translate is available under the [Apache License 2.0](LICENSE).
