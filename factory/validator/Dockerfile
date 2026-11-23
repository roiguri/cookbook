# Isolated Read-Only Holdout Validator Container (Local WSL2 Android Convergence)
#
# Mounts the private `cookbook-factory-holdout` repository strictly read-only at
# `/holdout` inside this container while connecting to the host WSL2 Android
# Emulator (`adb`) and Cookbook DTU (`127.0.0.1:9200-9203`) via `--network=host`.
# Workspace Builder Agents never have filesystem or token access to `/holdout`.
FROM eclipse-temurin:21-jdk-jammy

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    unzip \
    android-tools-adb \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && curl -Ls "https://get.maestro.mobile.dev" | bash \
    && rm -rf /var/lib/apt/lists/*

ENV PATH="/root/.maestro/bin:${PATH}"
WORKDIR /validator

ENTRYPOINT ["node", "/workspace/factory/validator/run-validation.mjs"]
