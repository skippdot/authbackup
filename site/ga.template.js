// Google Analytics 4 on authbackup.com. scripts/site.mjs writes this file to _site/ga.js only when GA_ID is set
// (the authbackup.com build in .github/workflows/pages.yml); other builds of the site have no analytics.
window.dataLayer = window.dataLayer || [];
// gtag() must queue the `arguments` object itself: gtag.js ignores plain arrays, such as rest parameters.
function gtag() {
  window.dataLayer.push(arguments);
}
gtag('js', new Date());
gtag('config', /*GA_ID*/'');
