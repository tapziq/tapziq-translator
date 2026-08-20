plugins {
    id("com.android.application")
}

val tapziqTranslatorSourceVersionName = "0.2.0"
val tapziqTranslatorSourceVersionCode = 2000
val tapziqTranslatorVersionNameProperty = providers.gradleProperty(
    "tapziqTranslatorVersionName"
)
val tapziqTranslatorVersionCodeProperty = providers.gradleProperty(
    "tapziqTranslatorVersionCode"
)
val configuredVersionName = tapziqTranslatorVersionNameProperty.orElse(
    tapziqTranslatorSourceVersionName
)
val configuredVersionCode = tapziqTranslatorVersionCodeProperty.map { rawVersionCode ->
    rawVersionCode.toIntOrNull()
        ?: throw GradleException("tapziqTranslatorVersionCode must be a positive integer.")
}.orElse(tapziqTranslatorSourceVersionCode)

val releaseSigningVariables = mapOf(
    "TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE" to providers.environmentVariable(
        "TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE"
    ),
    "TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD" to providers.environmentVariable(
        "TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD"
    ),
    "TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS" to providers.environmentVariable(
        "TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS"
    ),
    "TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD" to providers.environmentVariable(
        "TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD"
    )
)
val hasCompleteReleaseSigning = releaseSigningVariables.values.all {
    it.orNull?.isNotBlank() == true
}
val gitHead = providers.exec {
    workingDir(rootDir)
    setEnvironment(System.getenv().filterKeys {
        it !in releaseSigningVariables.keys
    })
    commandLine("git", "rev-parse", "--verify", "HEAD")
}.standardOutput.asText
val gitWorktreeStatus = providers.exec {
    workingDir(rootDir)
    setEnvironment(System.getenv().filterKeys {
        it !in releaseSigningVariables.keys
    })
    commandLine("git", "status", "--porcelain", "--untracked-files=normal")
}.standardOutput.asText
val gitIgnoredSourceFiles = providers.exec {
    workingDir(rootDir)
    setEnvironment(System.getenv().filterKeys {
        it !in releaseSigningVariables.keys
    })
    commandLine(
        "git",
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--",
        "app/src",
        "smoke-probe/src"
    )
}.standardOutput.asText

android {
    namespace = "com.tapziq.translator"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.tapziq.translator"
        minSdk = 23
        targetSdk = 36
        versionCode = configuredVersionCode.get()
        versionName = configuredVersionName.get()
    }

    signingConfigs {
        if (hasCompleteReleaseSigning) {
            create("production") {
                storeFile = file(releaseSigningVariables.getValue(
                    "TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE"
                ).get())
                storePassword = releaseSigningVariables.getValue(
                    "TAPZIQ_TRANSLATOR_RELEASE_STORE_PASSWORD"
                ).get()
                keyAlias = releaseSigningVariables.getValue(
                    "TAPZIQ_TRANSLATOR_RELEASE_KEY_ALIAS"
                ).get()
                keyPassword = releaseSigningVariables.getValue(
                    "TAPZIQ_TRANSLATOR_RELEASE_KEY_PASSWORD"
                ).get()
                storeType = "PKCS12"
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = false
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("production")
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

val verifyReleaseSigning by tasks.registering {
    group = "verification"
    description = "Fails production packaging unless signing and release inputs are valid."

    doLast {
        val missing = releaseSigningVariables.filterValues {
            it.orNull?.isNotBlank() != true
        }.keys
        if (missing.isNotEmpty()) {
            throw GradleException(
                "Production signing is required. Missing: ${missing.sorted().joinToString()}"
            )
        }

        val keystore = file(releaseSigningVariables.getValue(
            "TAPZIQ_TRANSLATOR_RELEASE_STORE_FILE"
        ).get()).canonicalFile
        if (!keystore.isFile) {
            throw GradleException("Production keystore does not exist: $keystore")
        }
        if (keystore.toPath().startsWith(rootDir.canonicalFile.toPath())) {
            throw GradleException("Production keystore must be stored outside the repository.")
        }

        val versionName = tapziqTranslatorVersionNameProperty.orNull
        val versionCodeText = tapziqTranslatorVersionCodeProperty.orNull
        if (versionName.isNullOrBlank() || versionCodeText.isNullOrBlank()) {
            throw GradleException(
                "Production releases require -PtapziqTranslatorVersionName and " +
                    "-PtapziqTranslatorVersionCode."
            )
        }
        if (!Regex("^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$")
                .matches(versionName)) {
            throw GradleException(
                "tapziqTranslatorVersionName must be a stable semantic version such as 1.2.3."
            )
        }
        if (!Regex("^[1-9][0-9]*$").matches(versionCodeText)) {
            throw GradleException("tapziqTranslatorVersionCode must be a positive integer.")
        }
        if (versionName != tapziqTranslatorSourceVersionName ||
            versionCodeText.toIntOrNull() != tapziqTranslatorSourceVersionCode) {
            throw GradleException(
                "Production release version inputs must match the committed source version."
            )
        }

        val sourceCommit = providers.gradleProperty(
            "tapziqTranslatorSourceCommit"
        ).orNull
        if (sourceCommit == null || !Regex("^[0-9a-f]{40}$").matches(sourceCommit)) {
            throw GradleException(
                "Production releases require -PtapziqTranslatorSourceCommit as a full " +
                    "lowercase Git SHA."
            )
        }
        val actualSourceCommit = gitHead.get().trim()
        if (sourceCommit != actualSourceCommit) {
            throw GradleException(
                "tapziqTranslatorSourceCommit must match the checked-out Git commit."
            )
        }
        if (gitWorktreeStatus.get().isNotBlank()) {
            throw GradleException("Production releases require a clean Git worktree.")
        }
        if (gitIgnoredSourceFiles.get().isNotBlank()) {
            throw GradleException(
                "Production releases refuse ignored files under app/src or smoke-probe/src."
            )
        }
    }
}

val productionArtifactTaskNames = setOf(
    "assembleRelease",
    "bundleRelease",
    "packageRelease",
    "packageReleaseBundle",
    "packageReleaseUniversalApk",
    "signReleaseBundle"
)

tasks.matching { it.name in productionArtifactTaskNames }.configureEach {
    dependsOn(verifyReleaseSigning)
}

tasks.register("checkProductionSigningTaskCoverage") {
    group = "verification"
    description = "Checks that every production artifact task requires signing verification."

    doLast {
        val signingGate = verifyReleaseSigning.get()
        val uncovered = productionArtifactTaskNames.filter { taskName ->
            val artifactTask = tasks.findByName(taskName) ?: return@filter true
            signingGate !in artifactTask.taskDependencies.getDependencies(artifactTask)
        }
        if (uncovered.isNotEmpty()) {
            throw GradleException(
                "Production artifact tasks bypass signing verification: " +
                    uncovered.sorted().joinToString()
            )
        }
    }
}
