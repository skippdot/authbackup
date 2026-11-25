# Website (authbackup.com): builds _site/ from site/ + PRIVACY.md, then serves it with unprivileged nginx on 8080.
#   docker build -t authbackup-site . && docker run --rm -p 8080:8080 authbackup-site
# (The test bench has its own image: bench/Dockerfile.)
FROM node:25-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370 AS build
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
