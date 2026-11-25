# Website (authbackup.com): builds _site/ from site/ + PRIVACY.md, then serves it with unprivileged nginx on 8080.
#   docker build -t authbackup-site . && docker run --rm -p 8080:8080 authbackup-site
# (The test bench has its own image: bench/Dockerfile.)
# The build stage only produces static files, so it runs on the build machine's platform (fast multi-arch builds).
FROM --platform=$BUILDPLATFORM node:22-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY site/ site/
COPY scripts/ scripts/
COPY docs/store-assets/ docs/store-assets/
COPY extension/manifest.json extension/
COPY extension/icons/ extension/icons/
COPY README.md PRIVACY.md ./
RUN node scripts/site.mjs

FROM nginxinc/nginx-unprivileged:alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/_site /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
