Tapziq Translate 0.1.0 is the first production release of the offline
English–Spanish translator.

Highlights:

- Translates its built-in set of useful words and phrases in both directions.
- Preserves punctuation, whitespace, and simple capitalization.
- Works fully offline and requests no Android permissions.
- Supports Android 6.0 (API 23) and newer.

Translations use the vocabulary included with the app. Words it does not recognize
are left unchanged.

The APK package is `com.tapziq.translator`. If a debug build was installed previously,
uninstall it before installing this production APK because Android will not replace an
app signed by a different certificate.

Verify the downloaded files with:

```sh
shasum -a 256 -c SHA256SUMS
```

Production signing certificate SHA-256:
`83d8cb8d8c5e4c894d72b7948a2c0a2efbc09b4a595d40be52e11d7206c32d7a`
