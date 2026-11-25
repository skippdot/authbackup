# Deploying AuthBackup

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/skippdot/authbackup) [![Deploy to Heroku](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/skippdot/authbackup) [![Run on Google Cloud](https://deploy.cloud.run/button.svg)](https://deploy.cloud.run/?git_repo=https://github.com/skippdot/authbackup) [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/skippdot/authbackup) [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/skippdot/authbackup)

## What can be deployed

The extension itself has **no server**: it runs entirely in the browser and never talks to the network. There is nothing to host for it. This repository has two optional, independent things you can deploy:

| | What | Source | Image / output | Port |
|---|---|---|---|---|
| **Website** | The static site (authbackup.com): landing page in 8 languages, privacy policy, `llms.txt`. | `site/**` + `PRIVACY.md`, built by `node scripts/site.mjs` | `_site/` (or the root `Dockerfile`, nginx) | 8080 |
| **Test bench** | A fake "2FA service" that issues enrollment QR codes and verifies codes. Handy for e2e tests and as a public playground to try any authenticator. Python standard library only. | `bench/server.py` | `bench/Dockerfile` | 8080 (8793 locally) |

The bench is safe to expose publicly: every secret it issues is fake and lives only in process memory (restart = clean slate), it keeps at most the newest 1000 enrollments, caps request bodies at 16 KiB and only serves its own files. Do not put real accounts on it.

Both images are built from the **repository root** as the Docker build context:

```sh
docker build -t authbackup-site .
docker build -f bench/Dockerfile -t authbackup-bench .
```

The bench reads `HOST` (default `127.0.0.1`; the image sets `0.0.0.0`) and `PORT` (the PaaS convention; falls back to the first argument, then 8793). It answers `GET /healthz` with `200 ok`.

> **Status.** Everything below was written against each platform's documented config format. Only the local Docker, `docker compose` and CI smoke tests were actually run. The real deploys on Render, Railway, Fly.io, Heroku, Cloud Run, App Runner, Amplify, Vercel and Netlify are **untested**; the config files parse (YAML/JSON/TOML) but have not been exercised by those platforms.

## Docker / docker compose

```sh
docker compose up            # website on http://localhost:8080, bench on http://localhost:8793
docker compose down
```

Or one at a time:

```sh
docker run --rm -p 8080:8080 authbackup-site
docker run --rm -p 8793:8080 authbackup-bench
```

Both containers run as a non-root user and have a `HEALTHCHECK`. The website image sets a strict CSP (`default-src 'self'; img-src 'self' data:; frame-ancestors 'none'`), `X-Content-Type-Options`, `Referrer-Policy`, gzip, and long caching for `/img` and `/style.css` (`deploy/nginx.conf`).

## Render (website + bench)

Use the **Deploy to Render** button, or in the dashboard choose *New > Blueprint* and point it at this repo. `render.yaml` creates a static site (`npm ci --ignore-scripts && node scripts/site.mjs`, publish `_site`) and a Docker web service for the bench (`bench/Dockerfile`, health check `/healthz`). Delete the service you do not need.

## Railway (bench)

*New Project > Deploy from GitHub repo*. `railway.json` selects `bench/Dockerfile` and the `/healthz` health check. Railway injects `PORT`; the bench listens on it. Generate a public domain under *Settings > Networking*. Or with the CLI: `railway up`.

## Fly.io (bench)

```sh
fly launch --copy-config --no-deploy   # reads fly.toml; pick an app name
fly deploy
```

`fly.toml` builds `bench/Dockerfile`, uses internal port 8080 and an HTTP check on `/healthz`; machines stop when idle.

## Heroku (bench)

Use the **Deploy to Heroku** button (reads `app.json`, container stack), or:

```sh
heroku create
heroku stack:set container
git push heroku main        # builds bench/Dockerfile via heroku.yml
```

## Google Cloud Run

The Cloud Run button above builds the root `Dockerfile`, i.e. **the website**. The bench image needs `extension/vendor/` (the QR library) from the repository root as build context, so deploy it from a pushed image as below.

```sh
# Bench, from the repository root:
gcloud artifacts repositories create authbackup --repository-format=docker --location=REGION
docker build -f bench/Dockerfile -t REGION-docker.pkg.dev/PROJECT/authbackup/bench .
docker push REGION-docker.pkg.dev/PROJECT/authbackup/bench
gcloud run deploy authbackup-bench --image REGION-docker.pkg.dev/PROJECT/authbackup/bench \
  --region REGION --allow-unauthenticated --port 8080

# Website: the root Dockerfile is picked up by --source
gcloud run deploy authbackup-site --source . --region REGION --allow-unauthenticated --port 8080
```

Cloud Run sets `PORT` itself; the images honor it.

## AWS

- **App Runner** (bench or website): push the image to ECR, then create an App Runner service from it.
  ```sh
  aws ecr create-repository --repository-name authbackup-bench
  aws ecr get-login-password --region REGION | docker login --username AWS --password-stdin ACCOUNT.dkr.ecr.REGION.amazonaws.com
  docker build -f bench/Dockerfile -t ACCOUNT.dkr.ecr.REGION.amazonaws.com/authbackup-bench .
  docker push ACCOUNT.dkr.ecr.REGION.amazonaws.com/authbackup-bench
  ```
  In the console: *App Runner > Create service > Container registry > Amazon ECR*, port `8080`, health check protocol HTTP, path `/healthz`.
- **Amplify Hosting** (website): connect the repo; build settings: `npm ci --ignore-scripts`, then `node scripts/site.mjs`, base directory `_site`. Add a rewrite `/privacy` to `/privacy.html` (200) and the headers from `vercel.json`.
- **S3 + CloudFront** (website): `npm ci --ignore-scripts && node scripts/site.mjs`, then `aws s3 sync _site s3://BUCKET --delete`. Put CloudFront in front, and add a CloudFront Function that maps `/privacy` to `/privacy.html` and `/de/` to `/de/index.html`, plus a response headers policy with the CSP above.

## Vercel (website)

Use the **Deploy with Vercel** button or `vercel --prod`. `vercel.json` sets the build command, output directory `_site`, clean URLs (`/privacy`) and the security headers.

## Netlify (website)

Use the **Deploy to Netlify** button or `netlify deploy --prod`. `netlify.toml` sets the build command, publish directory `_site` and the security headers. Pretty URLs work out of the box.

## Any static host

```sh
npm ci --ignore-scripts
node scripts/site.mjs      # writes _site/
```

Upload `_site/` to any static host (GitHub Pages, Cloudflare Pages, S3, your own nginx). For clean URLs the host must resolve `/privacy` to `privacy.html` and `/de/` to `de/index.html`; if it cannot, link to `/privacy.html` instead. The repository's own `pages.yml` workflow publishes `_site/` to GitHub Pages at <https://authbackup.com>.

## CI

`.github/workflows/ci.yml` (job `docker`) builds both images and smoke-tests them: `/healthz` on the bench, `/`, `/privacy`, `/de/` and the security headers on the site.
