const {APP_TITLE, APP_PRIVACY_PATH, brandManifest} = require('../src/lib/brand');
const path = require('path');

// Keep inherited static files untouched for upstream merges. The local build
// publishes our notice instead of presenting the upstream operator's policy.
module.exports = (content, absolutePath) => {
    switch (path.basename(absolutePath)) {
    case 'manifest.webmanifest':
        return JSON.stringify(brandManifest(JSON.parse(content.toString())), null, 2);
    case 'privacy.html':
        return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy information - ${APP_TITLE}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:42rem;margin:4rem auto;padding:0 1.5rem;color-scheme:light dark}</style>
</head><body><h1>Preview privacy information</h1>
<p>This is ${APP_TITLE}, not the TurboWarp service. This page describes the main data flows in the hosted experimental preview.</p>
<p>Operated by <strong>Griffpatch Ltd</strong>, company number 13965954.
Registered office: Atrium, York Eco Business Centre, Amy Johnson Way, York, United Kingdom, YO30 4AG.
For privacy, security or other private matters: <a href="mailto:studio@griffpatch.academy">studio@griffpatch.academy</a>.</p>
<h2>When you edit</h2>
<p>The editor works with your project in this browser. Saving to your computer downloads a file.
Your browser can also store preferences, backpack items and recovery copies. Clearing site data
can remove these, so save important work to a file first.</p>
<h2>When you use online features</h2>
<p>Loading Scratch projects or library assets can contact Scratch and TurboWarp services.
Cloud variables send project and variable messages to a cloud server. Extensions can make
network requests; some trusted extensions run without a sandbox. Opening the Packager integration
can pass your project and its name to the external TurboWarp Packager page.</p>
<p>Those services receive the requests and connection information needed to provide them.
Do not put private information into cloud variables or untrusted projects/extensions.</p>
<h2>Browser storage and measurements</h2>
<p>Preferences and help acknowledgement use localStorage. Backpack and project recovery use
IndexedDB. Recovery copies are not a substitute for saving your work. This code disables the
Scratch analytics adapter; upstream Windchimes telemetry is off unless explicitly enabled at build time.</p>
<h2>Hosting</h2>
<p>The preview is hosted by Cloudflare at studio.griffpatch.academy, with a separate workers.dev staging address. Cloudflare receives
connection and request information, such as IP addresses and requested URLs, to serve and protect the site.
Cloudflare may set security cookies on griffpatch.academy and its subdomains. Studio does not enable application request logs or add analytics to this deployment;
this does not mean Cloudflare performs no infrastructure or security logging.
The site is publicly accessible, not password protected. Use non-sensitive test projects.</p>
<h2>Your choices and contact</h2>
<p>You can use the editor without creating a Griffpatch Studio account, clear its browser storage, avoid optional online features and save projects locally.
For questions about information handled directly by Griffpatch Ltd, or to exercise applicable data-protection rights, email
<a href="mailto:studio@griffpatch.academy">studio@griffpatch.academy</a>. Requests handled by an external service are also subject to that provider's privacy information.</p>
<p><a href="${APP_PRIVACY_PATH}">Read the current preview privacy and service information</a>.</p>
<p>The <a href="https://turbowarp.org/privacy.html">TurboWarp privacy policy</a> describes the upstream service, not this fork.</p>
</body></html>`;
    default:
        return content;
    }
};
